/**
 * The jobs repository — one claim, one property, one loss.
 *
 * Money terms live on the job rather than only on the company, because a
 * contractor waives O&P on a small job and a carrier argues about tax on a big
 * one. Defaults are copied from the company at creation and editable after.
 */

import { patchRecord, softDeleteRecord, upsertRecord } from './repository';
import type { LocalDatabase } from './types';

export type Peril = 'water' | 'fire' | 'smoke' | 'wind' | 'hail' | 'mold' | 'other';

export type JobStatus =
  | 'inspecting'
  | 'estimating'
  | 'sent'
  | 'approved'
  | 'closed'
  | 'lost';

/**
 * What a job can do next. A contractor revising a rejected estimate goes back
 * to estimating; a closed job is done. Guarding this in one place stops a
 * stray tap from moving a claim somewhere it cannot come back from.
 */
export const JOB_STATUS_FLOW: Record<JobStatus, readonly JobStatus[]> = {
  inspecting: ['estimating', 'lost'],
  estimating: ['inspecting', 'sent', 'lost'],
  sent: ['estimating', 'approved', 'lost'],
  approved: ['estimating', 'closed'],
  closed: [],
  lost: ['inspecting'],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  if (from === to) return true;
  return JOB_STATUS_FLOW[from].includes(to);
}

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  inspecting: 'Inspecting',
  estimating: 'Estimating',
  sent: 'Sent',
  approved: 'Approved',
  closed: 'Closed',
  lost: 'Lost',
};

export interface JobRecord {
  id: string;
  companyId: string;
  claimNo: string | null;
  policyNo: string | null;
  carrier: string | null;
  adjusterName: string | null;
  adjusterEmail: string | null;
  dateOfLoss: string | null;
  peril: Peril;
  status: JobStatus;
  propertyAddress1: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  propertyPostal: string | null;
  yearBuilt: number | null;
  homeownerName: string | null;
  homeownerPhone: string | null;
  homeownerEmail: string | null;
  deductibleCents: number;
  opPct: number;
  taxPct: number;
  taxBase: 'materials' | 'all';
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface SaveJobInput {
  id: string;
  companyId: string;
  peril?: Peril;
  status?: JobStatus;
  claimNo?: string | null;
  policyNo?: string | null;
  carrier?: string | null;
  adjusterName?: string | null;
  adjusterEmail?: string | null;
  dateOfLoss?: string | null;
  propertyAddress1?: string | null;
  propertyCity?: string | null;
  propertyState?: string | null;
  propertyPostal?: string | null;
  yearBuilt?: number | null;
  homeownerName?: string | null;
  homeownerPhone?: string | null;
  homeownerEmail?: string | null;
  deductibleCents?: number;
  opPct?: number;
  taxPct?: number;
  taxBase?: 'materials' | 'all';
}

interface JobRow {
  id: string;
  company_id: string;
  claim_no: string | null;
  policy_no: string | null;
  carrier: string | null;
  adjuster_name: string | null;
  adjuster_email: string | null;
  date_of_loss: string | null;
  peril: string;
  status: string;
  property_address1: string | null;
  property_city: string | null;
  property_state: string | null;
  property_postal: string | null;
  year_built: number | null;
  homeowner_name: string | null;
  homeowner_phone: string | null;
  homeowner_email: string | null;
  deductible_cents: number;
  op_pct: number;
  tax_pct: number;
  tax_base: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function toRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    claimNo: row.claim_no,
    policyNo: row.policy_no,
    carrier: row.carrier,
    adjusterName: row.adjuster_name,
    adjusterEmail: row.adjuster_email,
    dateOfLoss: row.date_of_loss,
    peril: row.peril as Peril,
    status: row.status as JobStatus,
    propertyAddress1: row.property_address1,
    propertyCity: row.property_city,
    propertyState: row.property_state,
    propertyPostal: row.property_postal,
    yearBuilt: row.year_built,
    homeownerName: row.homeowner_name,
    homeownerPhone: row.homeowner_phone,
    homeownerEmail: row.homeowner_email,
    deductibleCents: row.deductible_cents,
    opPct: row.op_pct,
    taxPct: row.tax_pct,
    taxBase: row.tax_base as 'materials' | 'all',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/** A one-line address for the job list, falling back to the claim number. */
export function jobTitle(job: JobRecord): string {
  if (job.propertyAddress1?.trim()) return job.propertyAddress1.trim();
  if (job.claimNo?.trim()) return `Claim ${job.claimNo.trim()}`;
  return 'Untitled job';
}

export function jobSubtitle(job: JobRecord): string {
  const parts = [job.propertyCity, job.propertyState].filter(Boolean);
  return parts.join(', ');
}

export async function saveJob(
  db: LocalDatabase,
  input: SaveJobInput,
  now: number = Date.now(),
): Promise<JobRecord> {
  await upsertRecord(
    db,
    {
      entity: 'jobs',
      id: input.id,
      companyId: input.companyId,
      columns: {
        claim_no: input.claimNo ?? null,
        policy_no: input.policyNo ?? null,
        carrier: input.carrier ?? null,
        adjuster_name: input.adjusterName ?? null,
        adjuster_email: input.adjusterEmail ?? null,
        date_of_loss: input.dateOfLoss ?? null,
        peril: input.peril ?? 'water',
        status: input.status ?? 'inspecting',
        property_address1: input.propertyAddress1 ?? null,
        property_city: input.propertyCity ?? null,
        property_state: input.propertyState ?? null,
        property_postal: input.propertyPostal ?? null,
        year_built: input.yearBuilt ?? null,
        homeowner_name: input.homeownerName ?? null,
        homeowner_phone: input.homeownerPhone ?? null,
        homeowner_email: input.homeownerEmail ?? null,
        deductible_cents: input.deductibleCents ?? 0,
        op_pct: input.opPct ?? 20,
        tax_pct: input.taxPct ?? 0,
        tax_base: input.taxBase ?? 'materials',
      },
    },
    now,
  );

  const job = await getJob(db, input.id);
  if (!job) throw new Error(`job ${input.id} vanished immediately after being saved`);
  return job;
}

/** The fields a contractor types about a job, as opposed to its status or rates. */
export interface JobDetails {
  propertyAddress1: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  propertyPostal: string | null;
  claimNo: string | null;
  carrier: string | null;
  homeownerName: string | null;
  homeownerPhone: string | null;
  dateOfLoss: string | null;
}

const blankToNull = (value: string | null): string | null => value?.trim() || null;

/**
 * Edits only those fields. saveJob writes every column, so using it here would
 * quietly reset a job's status and rates to their defaults.
 */
export async function updateJobDetails(
  db: LocalDatabase,
  id: string,
  details: JobDetails,
  now: number = Date.now(),
): Promise<JobRecord | null> {
  await patchRecord(
    db,
    'jobs',
    id,
    {
      property_address1: blankToNull(details.propertyAddress1),
      property_city: blankToNull(details.propertyCity),
      property_state: blankToNull(details.propertyState),
      property_postal: blankToNull(details.propertyPostal),
      claim_no: blankToNull(details.claimNo),
      carrier: blankToNull(details.carrier),
      homeowner_name: blankToNull(details.homeownerName),
      homeowner_phone: blankToNull(details.homeownerPhone),
      date_of_loss: blankToNull(details.dateOfLoss),
    },
    now,
  );
  return getJob(db, id);
}

export async function listJobs(db: LocalDatabase, companyId: string): Promise<JobRecord[]> {
  const rows = await db.adapter.all<JobRow>(
    `select * from jobs
      where company_id = ? and deleted_at is null
      order by updated_at desc`,
    [companyId],
  );
  return rows.map(toRecord);
}

export async function getJob(db: LocalDatabase, id: string): Promise<JobRecord | null> {
  const [row] = await db.adapter.all<JobRow>(`select * from jobs where id = ?`, [id]);
  return row ? toRecord(row) : null;
}

export class InvalidJobTransition extends Error {
  constructor(
    readonly from: JobStatus,
    readonly to: JobStatus,
  ) {
    super(`a job cannot go from ${JOB_STATUS_LABELS[from]} to ${JOB_STATUS_LABELS[to]}`);
    this.name = 'InvalidJobTransition';
  }
}

export async function setJobStatus(
  db: LocalDatabase,
  id: string,
  status: JobStatus,
  now: number = Date.now(),
): Promise<JobRecord> {
  const job = await getJob(db, id);
  if (!job) throw new Error(`job ${id} not found`);
  if (!canTransition(job.status, status)) throw new InvalidJobTransition(job.status, status);

  await patchRecord(db, 'jobs', id, { status }, now);
  return { ...job, status, updatedAt: now };
}

export async function softDeleteJob(
  db: LocalDatabase,
  id: string,
  now: number = Date.now(),
): Promise<void> {
  await softDeleteRecord(db, 'jobs', id, now);
}

/** Room and photo counts for the job list, in one query rather than N. */
export interface JobSummary {
  jobId: string;
  rooms: number;
  photos: number;
}

export async function jobSummaries(
  db: LocalDatabase,
  companyId: string,
): Promise<Map<string, JobSummary>> {
  const rows = await db.adapter.all<{ job_id: string; rooms: number; photos: number }>(
    `select j.id as job_id,
            (select count(*) from rooms r where r.job_id = j.id and r.deleted_at is null) as rooms,
            (select count(*) from photos p where p.job_id = j.id and p.deleted_at is null) as photos
       from jobs j
      where j.company_id = ? and j.deleted_at is null`,
    [companyId],
  );
  return new Map(
    rows.map((r) => [r.job_id, { jobId: r.job_id, rooms: r.rooms, photos: r.photos }]),
  );
}
