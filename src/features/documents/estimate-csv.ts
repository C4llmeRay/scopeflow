/**
 * Line-item CSV export.
 *
 * The plan's honest answer to carriers that only accept Xactimate: scope the
 * job fast in the field, then re-key only what a strict carrier demands. A
 * clean CSV makes that re-key quick, and it is the difference between a large
 * net time win and no win at all.
 *
 * Written RFC 4180 style so it opens correctly in Excel and round-trips through
 * this app's own reader.
 */

import { centsToDollars } from '../../core/units';
import type { EstimateRecord, EstimateSnapshot } from '../../db/estimates';

export const ESTIMATE_CSV_HEADERS = [
  'Room',
  'Code',
  'Description',
  'Unit',
  'Quantity',
  'Waste %',
  'Billed quantity',
  'Material cost',
  'Labor cost',
  'Unit price',
  'Total',
] as const;

/** Quotes a field only when it needs it, and doubles any quotes inside. */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text === '') return '';
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvRow(values: (string | number | null | undefined)[]): string {
  return values.map(csvField).join(',');
}

/** Money as a plain decimal — no currency symbol, so a spreadsheet reads it as a number. */
const money = (cents: number): string => centsToDollars(cents).toFixed(2);

export function renderEstimateCsv(estimate: EstimateRecord): string {
  const snapshot: EstimateSnapshot = estimate.snapshot;
  const roomNames = new Map(snapshot.rooms.map((room) => [room.id, room.name]));

  const rows = [
    csvRow([...ESTIMATE_CSV_HEADERS]),
    ...snapshot.lines.map((line) =>
      csvRow([
        line.roomId ? (roomNames.get(line.roomId) ?? '') : 'Whole job',
        line.code,
        line.description,
        line.unit,
        line.qty,
        line.wastePct,
        line.billedQty,
        money(line.materialUnitCents),
        money(line.laborUnitCents),
        money(line.materialUnitCents + line.laborUnitCents),
        money(line.totalCents),
      ]),
    ),
  ];

  // Totals go below the lines, separated by a blank row, so importing the
  // sheet elsewhere picks up the line items cleanly and a human still sees the
  // arithmetic.
  rows.push('');
  rows.push(csvRow(['', '', 'Line subtotal', '', '', '', '', '', '', '', money(estimate.lineSubtotalCents)]));
  if (estimate.opCents > 0) {
    rows.push(
      csvRow(['', '', `Overhead and profit (${estimate.opPct}%)`, '', '', '', '', '', '', '', money(estimate.opCents)]),
    );
  }
  if (estimate.taxCents > 0) {
    rows.push(csvRow(['', '', `Sales tax (${estimate.taxPct}%)`, '', '', '', '', '', '', '', money(estimate.taxCents)]));
  }
  rows.push(csvRow(['', '', 'Replacement cost value', '', '', '', '', '', '', '', money(estimate.rcvCents)]));
  if (estimate.depreciationCents > 0) {
    rows.push(csvRow(['', '', 'Less depreciation', '', '', '', '', '', '', '', `-${money(estimate.depreciationCents)}`]));
    rows.push(csvRow(['', '', 'Actual cash value', '', '', '', '', '', '', '', money(estimate.acvCents)]));
  }
  if (estimate.deductibleCents > 0) {
    rows.push(
      csvRow(['', '', 'Less deductible', '', '', '', '', '', '', '', `-${money(estimate.deductibleCents)}`]),
    );
  }
  rows.push(csvRow(['', '', 'Net claim', '', '', '', '', '', '', '', money(estimate.netClaimCents)]));

  // CRLF and a trailing newline: what Excel expects.
  return rows.join('\r\n') + '\r\n';
}
