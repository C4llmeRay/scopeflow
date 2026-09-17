/**
 * Writes sample estimate and photo report HTML to a folder, so the templates
 * can be opened in a browser and iterated on without a device or a build.
 *
 *   npm run preview:docs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CompanyRecord } from '../src/db/companies';
import type { EstimateRecord } from '../src/db/estimates';
import { renderEstimateDocument } from '../src/features/documents/estimate-document';
import { renderEstimateCsv } from '../src/features/documents/estimate-csv';
import { renderPhotoReport } from '../src/features/documents/photo-report';

const outDir = process.argv[2] ?? join(process.cwd(), '.preview');
mkdirSync(outDir, { recursive: true });

const company: CompanyRecord = {
  id: 'co-1',
  name: 'Harbor Restoration LLC',
  licenseNo: 'TX-RC-118244',
  logoUrl: null,
  phone: '(512) 555-0142',
  email: 'office@harborrestoration.test',
  addressLine1: '4400 Shoal Creek Blvd',
  addressLine2: null,
  city: 'Austin',
  state: 'TX',
  postalCode: '78756',
  defaultOpPct: 20,
  defaultTaxPct: 8.25,
  defaultTaxBase: 'materials',
  aiJobCeilingCents: 500,
  subscriptionStatus: 'active',
  cancelAtPeriodEnd: false,
  trialEndsAt: null,
  currentPeriodEnd: null,
  estimateTerms:
    'This estimate covers the damage visible and accessible at the time of inspection. ' +
    'Concealed damage found during demolition may require a supplement. Prices are valid ' +
    'for 30 days. Work begins on written authorisation.',
  createdAt: 0,
  updatedAt: 0,
};

const mk = (
  roomId: string, code: string, description: string, unit: string,
  qty: number, mat: number, lab: number, waste = 0, dep = 0,
) => {
  const billedQty = Math.round(qty * (1 + waste / 100) * 100) / 100;
  return {
    id: `${roomId}-${code}`, roomId, code, description, unit, qty, billedQty,
    wastePct: waste, materialUnitCents: mat, laborUnitCents: lab,
    totalCents: Math.round(billedQty * mat) + Math.round(billedQty * lab),
    depreciationCents: dep,
  };
};

// The plan's worked example, plus a second room so grouping is visible.
const lines = [
  mk('r1', 'WTR-EXT', 'Water extraction, carpeted floor', 'SF', 168, 0, 62),
  mk('r1', 'FCC-RMV', 'Remove carpet', 'SF', 168, 0, 32),
  mk('r1', 'FCC-PAD', 'Remove and dispose carpet pad', 'SF', 168, 0, 28),
  mk('r1', 'DRY-FC2', 'Drywall flood cut and remove, 2 ft', 'SF', 104, 0, 186),
  mk('r1', 'INS-R13', 'R-13 batt insulation, remove and replace', 'SF', 104, 95, 47, 5),
  mk('r1', 'EQP-DEH', 'Dehumidifier (LGR), per day', 'DA', 3, 0, 8800),
  mk('r1', 'EQP-AM', 'Air mover, per day', 'DA', 12, 0, 2650),
  mk('r1', 'DRY-HTF', 'Drywall hang, tape, float and texture', 'SF', 104, 130, 144, 10),
  mk('r1', 'PNT-W2', 'Paint walls, two coats', 'SF', 384, 35, 57),
  mk('r1', 'FCC-CPT', 'Carpet with pad, replace', 'SF', 168, 320, 90, 10, 27552),
  mk('r1', 'BAS-RR', 'Baseboard, remove and replace', 'LF', 49, 240, 145, 8),
  mk('r2', 'WTR-EXT', 'Water extraction, carpeted floor', 'SF', 80, 0, 62),
  mk('r2', 'BAS-RR', "O'Brien trim <special> & co", 'LF', 36, 240, 145, 8),
];

const lineSubtotal = lines.reduce((s, l) => s + l.totalCents, 0);
const materialSubtotal = lines.reduce((s, l) => s + Math.round(l.billedQty * l.materialUnitCents), 0);
const opCents = Math.round(lineSubtotal * 0.2);
const taxCents = Math.round(materialSubtotal * 0.0825);
const rcv = lineSubtotal + opCents + taxCents;
const depreciation = lines.reduce((s, l) => s + l.depreciationCents, 0);
const acv = rcv - depreciation;

const estimate: EstimateRecord = {
  id: 'est-1', companyId: 'co-1', jobId: 'job-1', version: 2, status: 'draft',
  lineSubtotalCents: lineSubtotal,
  materialSubtotalCents: materialSubtotal,
  laborSubtotalCents: lineSubtotal - materialSubtotal,
  opPct: 20, opCents, taxPct: 8.25, taxBase: 'materials', taxCents,
  rcvCents: rcv, depreciationCents: depreciation, recoverableDepreciationCents: depreciation,
  acvCents: acv, deductibleCents: 100000, netClaimCents: Math.max(0, acv - 100000),
  narrative:
    'Supply line failure at the upstairs hall bathroom lavatory. Water migrated through ' +
    'the hall into the master bedroom and down the interior wall cavity. Discovered ' +
    'approximately 14 hours after onset.',
  sharePath: null, sentAt: null, sentTo: null, createdAt: 0, updatedAt: 0,
  snapshot: {
    takenAt: '2026-09-15T12:00:00.000Z',
    job: {
      claimNo: 'CLM-2026-884120', carrier: 'Lone Star Mutual', dateOfLoss: '2026-09-11',
      propertyAddress1: '1812 Water Street', homeownerName: "Marcus O'Brien-Oyelaran",
    },
    rooms: [
      { id: 'r1', name: 'Master Bedroom', lengthIn: 144, widthIn: 168, heightIn: 96, floodCutHeightIn: 24 },
      { id: 'r2', name: 'Upstairs Hallway', lengthIn: 96, widthIn: 120, heightIn: 96, floodCutHeightIn: 24 },
    ],
    lines,
  },
};

const swatch = (hue: number) =>
  `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="hsl(${hue},18%,62%)"/><text x="200" y="158" font-family="sans-serif" font-size="22" fill="#fff" text-anchor="middle">sample photo</text></svg>`,
  ).toString('base64')}`;

writeFileSync(join(outDir, 'estimate.html'), renderEstimateDocument({ estimate, company }));
writeFileSync(join(outDir, 'estimate.csv'), renderEstimateCsv(estimate));
writeFileSync(
  join(outDir, 'photo-report.html'),
  renderPhotoReport({
    company,
    job: estimate.snapshot.job,
    rooms: [
      { id: 'r1', name: 'Master Bedroom' },
      { id: 'r2', name: 'Upstairs Hallway' },
    ],
    photos: [
      { id: 'p1', roomId: 'r1', src: swatch(200), caption: 'Water line at 14 in on the north wall', takenAt: 1789000000000, gpsLat: 30.2672, gpsLng: -97.7431 },
      { id: 'p2', roomId: 'r1', src: swatch(20), caption: 'Carpet and pad saturated wall to wall', takenAt: 1789000600000, gpsLat: 30.2672, gpsLng: -97.7431 },
      { id: 'p3', roomId: 'r2', src: swatch(120), caption: 'Path of migration from the bathroom', takenAt: 1789001200000, gpsLat: null, gpsLng: null },
      { id: 'p4', roomId: null, src: swatch(280), caption: null, takenAt: 1789001800000, gpsLat: null, gpsLng: null },
    ],
    preparedAt: 1789002000000,
  }),
);

console.log(`wrote estimate.html, photo-report.html and estimate.csv to ${outDir}`);
