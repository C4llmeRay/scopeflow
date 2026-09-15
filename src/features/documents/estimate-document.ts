/**
 * The estimate document.
 *
 * Rendered from the frozen snapshot, never from live tables. That is the whole
 * reason snapshots exist: reopening version 1 eighteen months into a dispute has
 * to produce byte-for-byte what the adjuster received, regardless of what the
 * price list has done since.
 *
 * One template, three destinations — printed to PDF on the phone, uploaded as a
 * shareable link, and shown in the in-app preview.
 */

import { formatUsd } from '../../core/units';
import type { CompanyRecord } from '../../db/companies';
import { companyAddress } from '../../db/companies';
import type { EstimateRecord, EstimateSnapshot } from '../../db/estimates';
import { documentShell, esc, formatDate, joinParts } from './html';

export interface EstimateDocumentInput {
  estimate: EstimateRecord;
  company: CompanyRecord;
}

type SnapshotLine = EstimateSnapshot['lines'][number];

interface RoomGroup {
  id: string | null;
  name: string;
  dims: string;
  lines: SnapshotLine[];
  totalCents: number;
}

const inchesToFeetLabel = (inches: number): string => {
  const feet = Math.floor(inches / 12);
  const rest = inches % 12;
  if (feet === 0) return `${rest}"`;
  return rest === 0 ? `${feet}'` : `${feet}' ${rest}"`;
};

/**
 * Groups the frozen lines by room, in the room order the snapshot recorded.
 * Lines with no room — a job-wide item — fall into a final group rather than
 * disappearing.
 */
export function groupLinesByRoom(snapshot: EstimateSnapshot): RoomGroup[] {
  const groups = new Map<string | null, RoomGroup>();

  for (const room of snapshot.rooms) {
    groups.set(room.id, {
      id: room.id,
      name: room.name,
      dims: joinParts(
        [
          `${inchesToFeetLabel(room.lengthIn)} × ${inchesToFeetLabel(room.widthIn)} × ${inchesToFeetLabel(room.heightIn)}`,
          room.floodCutHeightIn > 0
            ? `${inchesToFeetLabel(room.floodCutHeightIn)} flood cut`
            : null,
        ],
        ' · ',
      ),
      lines: [],
      totalCents: 0,
    });
  }

  for (const line of snapshot.lines) {
    let group = groups.get(line.roomId);
    if (!group) {
      // A line whose room was deleted after the snapshot, or a job-wide item.
      group = { id: line.roomId, name: 'Whole job', dims: '', lines: [], totalCents: 0 };
      groups.set(line.roomId, group);
    }
    group.lines.push(line);
    group.totalCents += line.totalCents;
  }

  // Rooms that ended up with nothing scoped are not worth a heading.
  return [...groups.values()].filter((group) => group.lines.length > 0);
}

function renderLineRow(line: SnapshotLine): string {
  const qty = line.wastePct > 0 ? line.billedQty : line.qty;
  const wasteNote =
    line.wastePct > 0 ? `<div class="note">${esc(line.qty)} + ${esc(line.wastePct)}% waste</div>` : '';

  return `<tr>
  <td>${esc(line.code)}</td>
  <td>${esc(line.description)}${wasteNote}</td>
  <td class="num">${esc(qty)}</td>
  <td>${esc(line.unit)}</td>
  <td class="num">${esc(formatUsd(line.materialUnitCents + line.laborUnitCents))}</td>
  <td class="num">${esc(formatUsd(line.totalCents))}</td>
</tr>`;
}

function renderRoom(group: RoomGroup): string {
  return `<section class="room">
  <div class="room-head">
    <h3>${esc(group.name)}</h3>
    <strong>${esc(formatUsd(group.totalCents))}</strong>
  </div>
  ${group.dims ? `<div class="room-dims">${esc(group.dims)}</div>` : ''}
  <table class="lines">
    <thead>
      <tr>
        <th>Code</th><th>Description</th><th class="num">Qty</th>
        <th>Unit</th><th class="num">Unit price</th><th class="num">Total</th>
      </tr>
    </thead>
    <tbody>${group.lines.map(renderLineRow).join('\n')}</tbody>
  </table>
</section>`;
}

function renderTotals(estimate: EstimateRecord): string {
  const row = (label: string, value: string, cls = '') =>
    `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${esc(value)}</td></tr>`;

  const rows = [
    row('Line items', formatUsd(estimate.lineSubtotalCents)),
    estimate.opCents > 0
      ? row(`Overhead and profit (${estimate.opPct}%)`, formatUsd(estimate.opCents))
      : '',
    estimate.taxCents > 0
      ? row(
          `Sales tax (${estimate.taxPct}% on ${estimate.taxBase === 'materials' ? 'materials' : 'the subtotal'})`,
          formatUsd(estimate.taxCents),
        )
      : '',
    row('Replacement cost value', formatUsd(estimate.rcvCents), 'rule'),
    estimate.depreciationCents > 0
      ? row('Less depreciation', `−${formatUsd(estimate.depreciationCents)}`)
      : '',
    estimate.depreciationCents > 0
      ? row('Actual cash value', formatUsd(estimate.acvCents), 'rule')
      : '',
    estimate.deductibleCents > 0
      ? row('Less deductible', `−${formatUsd(estimate.deductibleCents)}`)
      : '',
    row('Net claim', formatUsd(estimate.netClaimCents), 'grand'),
  ].filter(Boolean);

  return `<table class="totals">${rows.join('\n')}</table>`;
}

export function renderEstimateDocument(input: EstimateDocumentInput): string {
  const { estimate, company } = input;
  const snapshot = estimate.snapshot;
  const groups = groupLinesByRoom(snapshot);

  const title = joinParts(
    [company.name, snapshot.job.propertyAddress1, `Estimate v${estimate.version}`],
    ' — ',
  );

  const facts = [
    ['Property', snapshot.job.propertyAddress1],
    ['Insured', snapshot.job.homeownerName],
    ['Carrier', snapshot.job.carrier],
    ['Claim number', snapshot.job.claimNo],
    ['Date of loss', formatDate(snapshot.job.dateOfLoss)],
    ['Prepared', formatDate(snapshot.takenAt)],
  ]
    .filter(([, value]) => Boolean(value))
    .map(
      ([label, value]) =>
        `<div class="fact"><span class="label">${esc(label)}</span>${esc(value)}</div>`,
    )
    .join('\n');

  const recoverableNote =
    estimate.recoverableDepreciationCents > 0
      ? `<p class="small muted">${esc(
          formatUsd(estimate.recoverableDepreciationCents),
        )} of the depreciation above is recoverable on proof of completion.</p>`
      : '';

  const body = `
<header class="letterhead">
  <div>
    <div class="company">${esc(company.name)}</div>
    <div class="small muted">${esc(companyAddress(company))}</div>
    <div class="small muted">${esc(joinParts([company.phone, company.email]))}</div>
    ${company.licenseNo ? `<div class="small muted">Licence ${esc(company.licenseNo)}</div>` : ''}
  </div>
  <div class="right">
    <h1>Estimate</h1>
    <div class="small muted">Version ${esc(estimate.version)}</div>
    ${estimate.sentAt ? `<div class="small muted">Sent ${esc(formatDate(estimate.sentAt))}</div>` : ''}
  </div>
</header>

<div class="facts">${facts}</div>

${groups.length > 0 ? groups.map(renderRoom).join('\n') : '<p class="muted">No scope on this estimate.</p>'}

<div class="totals-block">
  <h2>Totals</h2>
  ${renderTotals(estimate)}
  ${recoverableNote}
</div>

${
  estimate.narrative
    ? `<div class="terms"><span class="label">Summary of loss</span><p>${esc(estimate.narrative)}</p></div>`
    : ''
}

${
  company.estimateTerms
    ? `<div class="terms"><span class="label">Terms</span><p class="small muted">${esc(company.estimateTerms)}</p></div>`
    : ''
}

<footer class="doc-footer">
  <span>${esc(company.name)}${snapshot.job.claimNo ? ` · Claim ${esc(snapshot.job.claimNo)}` : ''}</span>
  <span>Estimate version ${esc(estimate.version)} · prepared ${esc(formatDate(snapshot.takenAt))}</span>
</footer>`;

  return documentShell({ title, body });
}

/** The filename a contractor and an adjuster can both find again. */
export function estimateFileName(estimate: EstimateRecord): string {
  const parts = [
    estimate.snapshot.job.claimNo || estimate.snapshot.job.propertyAddress1 || 'estimate',
    `v${estimate.version}`,
  ];
  return `${parts.join('-')}`.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').toLowerCase();
}
