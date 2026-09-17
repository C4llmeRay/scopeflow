/**
 * Estimates — the priced, frozen output.
 *
 * An estimate is an IMMUTABLE SNAPSHOT, not a live query. When one is sent, the
 * whole priced scope is frozen into `snapshot`. If the contractor then edits a
 * price or re-measures a room, the sent estimate must not change underneath
 * them: it is a claim document that can end up in a dispute, and reproducing
 * exactly what was sent on a given date is the entire point.
 *
 * Only accepted line items are priced. A suggestion that nobody tapped is not
 * part of the scope, and that is what keeps an AI proposal out of a total.
 */

import { computeEstimate, type EstimateLineInput, type EstimateTotals } from '../core/estimate';
import type { JobRecord } from './jobs';
import { listLineItems, type LineItemRecord } from './line-items';
import { iso, patchRecord, upsertRecord } from './repository';
import { listRooms } from './rooms';
import type { LocalDatabase } from './types';

export type EstimateStatus = 'draft' | 'sent' | 'approved' | 'rejected' | 'superseded';

export interface EstimateRecord {
  id: string;
  companyId: string;
  jobId: string;
  version: number;
  status: EstimateStatus;
  lineSubtotalCents: number;
  materialSubtotalCents: number;
  laborSubtotalCents: number;
  opPct: number;
  opCents: number;
  taxPct: number;
  taxBase: 'materials' | 'all';
  taxCents: number;
  rcvCents: number;
  depreciationCents: number;
  recoverableDepreciationCents: number;
  acvCents: number;
  deductibleCents: number;
  netClaimCents: number;
  snapshot: EstimateSnapshot;
  narrative: string | null;
  /** Where the public HTML rendering lives, when one has been published. */
  sharePath: string | null;
  sentAt: number | null;
  sentTo: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Everything needed to reproduce the estimate without reading another table. */
export interface EstimateSnapshot {
  takenAt: string;
  job: {
    claimNo: string | null;
    carrier: string | null;
    dateOfLoss: string | null;
    propertyAddress1: string | null;
    homeownerName: string | null;
  };
  rooms: {
    id: string;
    name: string;
    lengthIn: number;
    widthIn: number;
    heightIn: number;
    floodCutHeightIn: number;
  }[];
  lines: {
    id: string;
    roomId: string | null;
    code: string;
    description: string;
    unit: string;
    qty: number;
    billedQty: number;
    wastePct: number;
    materialUnitCents: number;
    laborUnitCents: number;
    totalCents: number;
    depreciationCents: number;
  }[];
}

interface EstimateRow {
  id: string;
  company_id: string;
  job_id: string;
  version: number;
  status: string;
  line_subtotal_cents: number;
  material_subtotal_cents: number;
  labor_subtotal_cents: number;
  op_pct: number;
  op_cents: number;
  tax_pct: number;
  tax_base: string;
  tax_cents: number;
  rcv_cents: number;
  depreciation_cents: number;
  recoverable_depreciation_cents: number;
  acv_cents: number;
  deductible_cents: number;
  net_claim_cents: number;
  snapshot: string;
  narrative: string | null;
  share_path: string | null;
  sent_at: number | null;
  sent_to: string | null;
  created_at: number;
  updated_at: number;
}

function toRecord(row: EstimateRow): EstimateRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    jobId: row.job_id,
    version: row.version,
    status: row.status as EstimateStatus,
    lineSubtotalCents: row.line_subtotal_cents,
    materialSubtotalCents: row.material_subtotal_cents,
    laborSubtotalCents: row.labor_subtotal_cents,
    opPct: row.op_pct,
    opCents: row.op_cents,
    taxPct: row.tax_pct,
    taxBase: row.tax_base as 'materials' | 'all',
    taxCents: row.tax_cents,
    rcvCents: row.rcv_cents,
    depreciationCents: row.depreciation_cents,
    recoverableDepreciationCents: row.recoverable_depreciation_cents,
    acvCents: row.acv_cents,
    deductibleCents: row.deductible_cents,
    netClaimCents: row.net_claim_cents,
    snapshot: JSON.parse(row.snapshot) as EstimateSnapshot,
    narrative: row.narrative,
    sharePath: row.share_path,
    sentAt: row.sent_at,
    sentTo: row.sent_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Maps a stored line item into what the calculator takes. */
export function toEstimateLine(item: LineItemRecord): EstimateLineInput {
  return {
    code: item.code,
    description: item.description,
    unit: item.unit,
    qty: item.qty,
    materialUnitCents: item.materialUnitCents,
    laborUnitCents: item.laborUnitCents,
    wastePct: item.wastePct,
    depreciation:
      item.ageYears !== null && item.usefulLifeYears !== null
        ? {
            ageYears: item.ageYears,
            usefulLifeYears: item.usefulLifeYears,
            recoverable: item.depreciationRecoverable,
          }
        : undefined,
  };
}

export interface LivePricing {
  totals: EstimateTotals;
  /** The accepted lines that were priced, in the order they were priced. */
  lines: LineItemRecord[];
  /** Lines waiting on a human tap. Not priced, but worth a badge in the UI. */
  suggestedCount: number;
}

/**
 * Prices a job's current scope without saving anything. This is what the
 * estimate review screen shows and what the running total at the bottom reads.
 */
export async function priceJob(db: LocalDatabase, job: JobRecord): Promise<LivePricing> {
  const all = await listLineItems(db, job.id);
  const accepted = all.filter((item) => item.status === 'accepted');

  const totals = computeEstimate(accepted.map(toEstimateLine), {
    opPct: job.opPct,
    taxPct: job.taxPct,
    taxBase: job.taxBase,
    deductibleCents: job.deductibleCents,
  });

  return {
    totals,
    lines: accepted,
    suggestedCount: all.filter((item) => item.status === 'suggested').length,
  };
}

export async function nextVersion(db: LocalDatabase, jobId: string): Promise<number> {
  const [row] = await db.adapter.all<{ max_version: number | null }>(
    `select max(version) as max_version from estimates where job_id = ?`,
    [jobId],
  );
  return (row?.max_version ?? 0) + 1;
}

export async function listEstimates(
  db: LocalDatabase,
  jobId: string,
): Promise<EstimateRecord[]> {
  const rows = await db.adapter.all<EstimateRow>(
    `select * from estimates where job_id = ? order by version desc`,
    [jobId],
  );
  return rows.map(toRecord);
}

export async function getEstimate(
  db: LocalDatabase,
  id: string,
): Promise<EstimateRecord | null> {
  const [row] = await db.adapter.all<EstimateRow>(`select * from estimates where id = ?`, [id]);
  return row ? toRecord(row) : null;
}

export class EstimateIsFrozen extends Error {
  constructor(readonly version: number) {
    super(`estimate version ${version} has been sent and cannot be edited — create a new version`);
    this.name = 'EstimateIsFrozen';
  }
}

/**
 * Freezes the job's current scope into a new estimate version.
 *
 * Every earlier version is marked superseded, and nothing that has been sent is
 * ever rewritten: revising a sent estimate means version 2, not an edit to
 * version 1.
 */
export async function createEstimateVersion(
  db: LocalDatabase,
  job: JobRecord,
  makeId: () => string,
  now: number = Date.now(),
): Promise<EstimateRecord> {
  const { totals, lines } = await priceJob(db, job);
  const rooms = await listRooms(db, job.id);
  const version = await nextVersion(db, job.id);
  const id = makeId();

  const snapshot: EstimateSnapshot = {
    takenAt: iso(now),
    job: {
      claimNo: job.claimNo,
      carrier: job.carrier,
      dateOfLoss: job.dateOfLoss,
      propertyAddress1: job.propertyAddress1,
      homeownerName: job.homeownerName,
    },
    rooms: rooms.map((room) => ({
      id: room.id,
      name: room.name,
      lengthIn: room.lengthIn,
      widthIn: room.widthIn,
      heightIn: room.heightIn,
      floodCutHeightIn: room.floodCutHeightIn,
    })),
    lines: totals.lines.map((priced, index) => ({
      id: lines[index]?.id ?? priced.code,
      roomId: lines[index]?.roomId ?? null,
      code: priced.code,
      description: priced.description,
      unit: priced.unit,
      qty: priced.qty,
      billedQty: priced.billedQty,
      wastePct: priced.wastePct,
      materialUnitCents: priced.materialUnitCents,
      laborUnitCents: priced.laborUnitCents,
      totalCents: priced.totalCents,
      depreciationCents: priced.depreciationCents,
    })),
  };

  // Earlier versions step aside rather than disappear. This goes through
  // patchRecord so the server hears about it too — a status change is allowed
  // on a sent estimate, unlike a change to any of its figures.
  for (const previous of await listEstimates(db, job.id)) {
    if (previous.status === 'draft' || previous.status === 'sent') {
      await patchRecord(db, 'estimates', previous.id, { status: 'superseded' }, now);
    }
  }

  await upsertRecord(
    db,
    {
      entity: 'estimates',
      id,
      companyId: job.companyId,
      columns: {
        job_id: job.id,
        version,
        status: 'draft',
        line_subtotal_cents: totals.lineSubtotalCents,
        material_subtotal_cents: totals.materialSubtotalCents,
        labor_subtotal_cents: totals.laborSubtotalCents,
        op_pct: totals.opPct,
        op_cents: totals.opCents,
        tax_pct: totals.taxPct,
        tax_base: totals.taxBase,
        tax_cents: totals.taxCents,
        rcv_cents: totals.rcvCents,
        depreciation_cents: totals.depreciationCents,
        recoverable_depreciation_cents: totals.recoverableDepreciationCents,
        acv_cents: totals.acvCents,
        deductible_cents: totals.deductibleCents,
        net_claim_cents: totals.netClaimCents,
        snapshot: JSON.stringify(snapshot),
      },
      payloadOverrides: { snapshot },
    },
    now,
  );

  const created = await getEstimate(db, id);
  if (!created) throw new Error(`estimate ${id} vanished immediately after being created`);
  return created;
}

/**
 * Records the carrier's answer on a sent estimate.
 *
 * Only a sent version can be answered: approving something nobody received is
 * a bookkeeping error, not a claim event. The figures are untouched — this
 * moves the status and nothing else, which is what the freeze trigger allows.
 */
export async function recordEstimateOutcome(
  db: LocalDatabase,
  id: string,
  outcome: 'approved' | 'rejected',
  now: number = Date.now(),
): Promise<EstimateRecord> {
  const estimate = await getEstimate(db, id);
  if (!estimate) throw new Error(`estimate ${id} not found`);
  if (estimate.sentAt === null) {
    throw new Error(`estimate version ${estimate.version} has not been sent yet`);
  }

  await patchRecord(db, 'estimates', id, { status: outcome }, now);

  const updated = await getEstimate(db, id);
  if (!updated) throw new Error(`estimate ${id} vanished`);
  return updated;
}

/**
 * Writes the summary of loss onto a DRAFT estimate.
 *
 * Refused once a version has been sent. The narrative is part of the document
 * an adjuster read, so changing it afterwards would make the stored estimate
 * disagree with the copy in their inbox — the exact thing snapshots exist to
 * prevent. Revising it means a new version.
 */
export async function setEstimateNarrative(
  db: LocalDatabase,
  id: string,
  narrative: string,
  now: number = Date.now(),
): Promise<EstimateRecord> {
  const estimate = await getEstimate(db, id);
  if (!estimate) throw new Error(`estimate ${id} not found`);
  if (estimate.sentAt !== null) throw new EstimateIsFrozen(estimate.version);

  await patchRecord(db, 'estimates', id, { narrative: narrative.trim() || null }, now);

  const updated = await getEstimate(db, id);
  if (!updated) throw new Error(`estimate ${id} vanished`);
  return updated;
}

/** The version a carrier is actually answering: the most recent sent one. */
export async function latestSentEstimate(
  db: LocalDatabase,
  jobId: string,
): Promise<EstimateRecord | null> {
  const versions = await listEstimates(db, jobId);
  return versions.find((version) => version.sentAt !== null) ?? null;
}

/** Records that a version went out. After this it is frozen. */
export async function markEstimateSent(
  db: LocalDatabase,
  id: string,
  sentTo: string,
  now: number = Date.now(),
): Promise<EstimateRecord> {
  const estimate = await getEstimate(db, id);
  if (!estimate) throw new Error(`estimate ${id} not found`);
  if (estimate.sentAt !== null) throw new EstimateIsFrozen(estimate.version);

  await db.adapter.transaction(async () => {
    await db.adapter.run(
      `update estimates set status = 'sent', sent_at = ?, sent_to = ?, updated_at = ? where id = ?`,
      [now, sentTo, now, id],
    );
    await db.outbox.enqueue(
      {
        entity: 'estimates',
        entityId: id,
        op: 'upsert',
        payload: {
          company_id: estimate.companyId,
          status: 'sent',
          sent_at: iso(now),
          sent_to: sentTo,
          updated_at: iso(now),
        },
      },
      now,
    );
  });

  const sent = await getEstimate(db, id);
  if (!sent) throw new Error(`estimate ${id} vanished after being sent`);
  return sent;
}

/**
 * When each job started, and when it first reached a frozen estimate.
 *
 * Feeds the time-to-estimate metric. A left join rather than an inner one on
 * purpose: a job with no estimate has to come back as null so the metric can
 * count it as unfinished, instead of silently disappearing and making the
 * average look better than the work actually was.
 */
export async function jobTimings(
  db: LocalDatabase,
  companyId: string,
): Promise<{ jobId: string; startedAt: number; firstEstimateAt: number | null }[]> {
  const rows = await db.adapter.all<{
    job_id: string;
    started_at: number;
    first_estimate_at: number | null;
  }>(
    `select j.id         as job_id,
            j.created_at as started_at,
            (select min(e.created_at)
               from estimates e
              where e.job_id = j.id
                and e.deleted_at is null) as first_estimate_at
       from jobs j
      where j.company_id = ?
        and j.deleted_at is null`,
    [companyId],
  );

  return rows.map((row) => ({
    jobId: row.job_id,
    startedAt: row.started_at,
    firstEstimateAt: row.first_estimate_at,
  }));
}
