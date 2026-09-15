import { describe, expect, it } from 'vitest';

import type { CompanyRecord } from '../../db/companies';
import type { EstimateRecord } from '../../db/estimates';
import { parseCsv } from '../pricing/csv';
import { csvField, ESTIMATE_CSV_HEADERS, renderEstimateCsv } from './estimate-csv';
import {
  estimateFileName,
  groupLinesByRoom,
  renderEstimateDocument,
} from './estimate-document';
import { esc, formatDate, joinParts } from './html';

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
  trialEndsAt: null,
  currentPeriodEnd: null,
  estimateTerms: 'Prices valid for 30 days.',
  createdAt: 0,
  updatedAt: 0,
};

const line = (over: Partial<EstimateRecord['snapshot']['lines'][number]> = {}) => ({
  id: 'l1',
  roomId: 'room-1',
  code: 'FCC-CPT',
  description: 'Carpet with pad, replace',
  unit: 'SF',
  qty: 168,
  billedQty: 168,
  wastePct: 0,
  materialUnitCents: 320,
  laborUnitCents: 90,
  totalCents: 68_880,
  depreciationCents: 0,
  ...over,
});

const estimate = (over: Partial<EstimateRecord> = {}): EstimateRecord => ({
  id: 'est-1',
  companyId: 'co-1',
  jobId: 'job-1',
  version: 1,
  status: 'draft',
  lineSubtotalCents: 68_880,
  materialSubtotalCents: 53_760,
  laborSubtotalCents: 15_120,
  opPct: 20,
  opCents: 13_776,
  taxPct: 7,
  taxBase: 'materials',
  taxCents: 3_763,
  rcvCents: 86_419,
  depreciationCents: 27_552,
  recoverableDepreciationCents: 27_552,
  acvCents: 58_867,
  deductibleCents: 100_000,
  netClaimCents: 0,
  narrative: null,
  sharePath: null,
  sentAt: null,
  sentTo: null,
  createdAt: 0,
  updatedAt: 0,
  snapshot: {
    takenAt: '2026-09-15T12:00:00.000Z',
    job: {
      claimNo: 'CLM-2026-884120',
      carrier: 'Lone Star Mutual',
      dateOfLoss: '2026-09-11',
      propertyAddress1: '1812 Water Street',
      homeownerName: 'Marcus Oyelaran',
    },
    rooms: [
      { id: 'room-1', name: 'Master Bedroom', lengthIn: 144, widthIn: 168, heightIn: 96, floodCutHeightIn: 24 },
    ],
    lines: [line()],
  },
  ...over,
});

describe('esc', () => {
  it('escapes every character that breaks HTML', () => {
    expect(esc(`<script>alert("x")</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
  });

  it('escapes ampersands first, so entities are not double-broken', () => {
    expect(esc('Ben & Sons <Ltd>')).toBe('Ben &amp; Sons &lt;Ltd&gt;');
  });

  it('escapes apostrophes, which appear in half of all surnames', () => {
    expect(esc("O'Brien")).toBe('O&#39;Brien');
  });

  it('renders nothing for null and undefined', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
});

describe('formatDate', () => {
  it('reads an ISO date and epoch millis alike', () => {
    expect(formatDate('2026-09-11')).toMatch(/September/);
    expect(formatDate(1_700_000_000_000)).toMatch(/November/);
  });

  it('says nothing rather than "Invalid Date"', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate('')).toBe('');
    expect(formatDate('not a date')).toBe('');
  });
});

describe('joinParts', () => {
  it('drops blanks instead of leaving stray separators', () => {
    expect(joinParts(['Austin', null, 'TX', '  ', '78756'])).toBe('Austin · TX · 78756');
    expect(joinParts([null, undefined])).toBe('');
  });
});

describe('renderEstimateDocument', () => {
  it('produces a complete standalone document', () => {
    const html = renderEstimateDocument({ estimate: estimate(), company });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
    // Self-contained: no external stylesheet, image or script to fetch.
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
    expect(html).not.toMatch(/<script/);
  });

  it('carries the letterhead an adjuster needs to reply to', () => {
    const html = renderEstimateDocument({ estimate: estimate(), company });
    expect(html).toContain('Harbor Restoration LLC');
    expect(html).toContain('TX-RC-118244');
    expect(html).toContain('(512) 555-0142');
    expect(html).toContain('4400 Shoal Creek Blvd');
  });

  it('carries the claim facts from the snapshot, not from live tables', () => {
    const html = renderEstimateDocument({ estimate: estimate(), company });
    expect(html).toContain('CLM-2026-884120');
    expect(html).toContain('Lone Star Mutual');
    expect(html).toContain('1812 Water Street');
    expect(html).toContain('Marcus Oyelaran');
  });

  it('prints room dimensions in feet and inches', () => {
    const html = renderEstimateDocument({ estimate: estimate(), company });
    // Foot marks come through the same escaping as everything else, which is
    // what stops a room named 12" Hallway from breaking the document.
    expect(html).toContain('12&#39; × 14&#39; × 8&#39;');
    expect(html).toContain('2&#39; flood cut');
  });

  it('prints a part-foot dimension with inches', () => {
    const odd = estimate();
    odd.snapshot.rooms[0] = {
      id: 'room-1', name: 'Nook', lengthIn: 150, widthIn: 96, heightIn: 90, floodCutHeightIn: 0,
    };
    const html = renderEstimateDocument({ estimate: odd, company });
    expect(html).toContain('12&#39; 6&quot;');
  });

  it('shows every total that reconciles the arithmetic', () => {
    const html = renderEstimateDocument({ estimate: estimate(), company });
    expect(html).toContain('$688.80'); // line subtotal
    expect(html).toContain('Overhead and profit (20%)');
    expect(html).toContain('Replacement cost value');
    expect(html).toContain('Less depreciation');
    expect(html).toContain('Actual cash value');
    expect(html).toContain('Less deductible');
    expect(html).toContain('Net claim');
  });

  it('omits totals rows that would read as zero', () => {
    const plain = estimate({
      opCents: 0,
      taxCents: 0,
      depreciationCents: 0,
      recoverableDepreciationCents: 0,
      deductibleCents: 0,
    });
    const html = renderEstimateDocument({ estimate: plain, company });
    expect(html).not.toContain('Overhead and profit');
    expect(html).not.toContain('Less depreciation');
    expect(html).not.toContain('Less deductible');
    expect(html).toContain('Net claim');
  });

  it('says how much depreciation comes back on completion', () => {
    const html = renderEstimateDocument({ estimate: estimate(), company });
    expect(html).toContain('$275.52 of the depreciation above is recoverable');
  });

  it('shows the waste factor rather than hiding it in the quantity', () => {
    const withWaste = estimate();
    withWaste.snapshot.lines = [line({ qty: 168, wastePct: 10, billedQty: 184.8, totalCents: 75_768 })];
    const html = renderEstimateDocument({ estimate: withWaste, company });
    expect(html).toContain('184.8');
    expect(html).toContain('168 + 10% waste');
  });

  it('prints the terms and a narrative when there is one', () => {
    const html = renderEstimateDocument({
      estimate: estimate({ narrative: 'Supply line failure at the hall bath.' }),
      company,
    });
    expect(html).toContain('Prices valid for 30 days.');
    expect(html).toContain('Supply line failure at the hall bath.');
  });

  it('renders an empty estimate without breaking', () => {
    const empty = estimate();
    empty.snapshot.lines = [];
    const html = renderEstimateDocument({ estimate: empty, company });
    expect(html).toContain('No scope on this estimate.');
  });
});

describe('renderEstimateDocument — escaping', () => {
  it('neutralises a script tag typed into a homeowner name', () => {
    const hostile = estimate();
    hostile.snapshot.job.homeownerName = '<script>alert(1)</script>';
    const html = renderEstimateDocument({ estimate: hostile, company });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('neutralises markup in a room name, a description and a note', () => {
    const hostile = estimate();
    hostile.snapshot.rooms[0].name = '<img src=x onerror=alert(1)>';
    hostile.snapshot.lines = [line({ description: '</td><script>x</script>' })];
    const html = renderEstimateDocument({ estimate: hostile, company });

    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>x</script>');
  });

  it('neutralises markup in the company name and terms', () => {
    const hostile = { ...company, name: '<b>Evil</b>', estimateTerms: '<script>y</script>' };
    const html = renderEstimateDocument({ estimate: estimate(), company: hostile });

    expect(html).not.toContain('<b>Evil</b>');
    expect(html).not.toContain('<script>y</script>');
  });

  it('keeps an apostrophe readable rather than mangled', () => {
    const named = estimate();
    named.snapshot.job.homeownerName = "Siobhán O'Brien";
    const html = renderEstimateDocument({ estimate: named, company });
    expect(html).toContain('O&#39;Brien');
  });

  it('has no unescaped angle brackets outside its own markup', () => {
    const hostile = estimate();
    hostile.snapshot.job.propertyAddress1 = '<<>>';
    hostile.snapshot.job.carrier = '"><h1>pwned</h1>';
    const html = renderEstimateDocument({ estimate: hostile, company });
    expect(html).not.toContain('<h1>pwned</h1>');
  });
});

describe('groupLinesByRoom', () => {
  it('groups in the room order the snapshot recorded', () => {
    const multi = estimate();
    multi.snapshot.rooms = [
      { id: 'r1', name: 'Master Bedroom', lengthIn: 144, widthIn: 168, heightIn: 96, floodCutHeightIn: 0 },
      { id: 'r2', name: 'Hallway', lengthIn: 96, widthIn: 120, heightIn: 96, floodCutHeightIn: 0 },
    ];
    multi.snapshot.lines = [
      line({ id: 'a', roomId: 'r2', totalCents: 100 }),
      line({ id: 'b', roomId: 'r1', totalCents: 200 }),
    ];

    const groups = groupLinesByRoom(multi.snapshot);
    expect(groups.map((g) => g.name)).toEqual(['Master Bedroom', 'Hallway']);
  });

  it('totals each room from its own lines', () => {
    const multi = estimate();
    multi.snapshot.lines = [
      line({ id: 'a', roomId: 'room-1', totalCents: 100 }),
      line({ id: 'b', roomId: 'room-1', totalCents: 250 }),
    ];
    expect(groupLinesByRoom(multi.snapshot)[0].totalCents).toBe(350);
  });

  it('drops a room that ended up with nothing scoped', () => {
    const multi = estimate();
    multi.snapshot.rooms.push({
      id: 'r-empty', name: 'Garage', lengthIn: 240, widthIn: 240, heightIn: 96, floodCutHeightIn: 0,
    });
    expect(groupLinesByRoom(multi.snapshot).map((g) => g.name)).toEqual(['Master Bedroom']);
  });

  it('keeps a job-wide line rather than losing it', () => {
    const multi = estimate();
    multi.snapshot.lines = [line({ roomId: null })];
    const groups = groupLinesByRoom(multi.snapshot);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Whole job');
  });

  it('keeps a line whose room vanished from the snapshot', () => {
    const multi = estimate();
    multi.snapshot.lines = [line({ roomId: 'deleted-room' })];
    expect(groupLinesByRoom(multi.snapshot)).toHaveLength(1);
  });
});

describe('estimateFileName', () => {
  it('leads with the claim number a person would search for', () => {
    expect(estimateFileName(estimate())).toBe('clm-2026-884120-v1');
  });

  it('falls back to the address when there is no claim number', () => {
    const noClaim = estimate();
    noClaim.snapshot.job.claimNo = null;
    expect(estimateFileName(noClaim)).toBe('1812-water-street-v1');
  });

  it('produces something safe for a filesystem', () => {
    const messy = estimate();
    messy.snapshot.job.claimNo = 'CLM/2026\\884 120:*?';
    expect(estimateFileName(messy)).toMatch(/^[\w.-]+$/);
  });
});

describe('renderEstimateCsv', () => {
  it('round-trips through this app own CSV reader', () => {
    const csv = renderEstimateCsv(estimate());
    const rows = parseCsv(csv);

    expect(rows[0]).toEqual([...ESTIMATE_CSV_HEADERS]);
    expect(rows[1]).toEqual([
      'Master Bedroom', 'FCC-CPT', 'Carpet with pad, replace', 'SF',
      '168', '0', '168', '3.20', '0.90', '4.10', '688.80',
    ]);
  });

  it('survives a description containing a comma and a quote', () => {
    const tricky = estimate();
    tricky.snapshot.lines = [line({ description: 'Carpet, "premium", replace' })];
    const rows = parseCsv(renderEstimateCsv(tricky));
    expect(rows[1][2]).toBe('Carpet, "premium", replace');
  });

  it('survives a description containing a newline', () => {
    const tricky = estimate();
    tricky.snapshot.lines = [line({ description: 'line one\nline two' })];
    const rows = parseCsv(renderEstimateCsv(tricky));
    expect(rows[1][2]).toBe('line one\nline two');
  });

  it('writes money as a plain number a spreadsheet can add up', () => {
    const csv = renderEstimateCsv(estimate());
    expect(csv).not.toContain('$');
    expect(csv).toContain('688.80');
  });

  it('puts the totals below the lines so an import picks up the scope cleanly', () => {
    const rows = parseCsv(renderEstimateCsv(estimate()));
    const lineRows = rows.slice(1).filter((r) => r[1] !== '');
    expect(lineRows).toHaveLength(1);
    expect(rows.some((r) => r.includes('Net claim'))).toBe(true);
  });

  it('uses CRLF, which is what Excel expects', () => {
    expect(renderEstimateCsv(estimate())).toContain('\r\n');
  });

  it('names the room, or says the line is job-wide', () => {
    const wide = estimate();
    wide.snapshot.lines = [line({ roomId: null })];
    expect(parseCsv(renderEstimateCsv(wide))[1][0]).toBe('Whole job');
  });
});

describe('csvField', () => {
  it('quotes only what needs quoting', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('has,comma')).toBe('"has,comma"');
    expect(csvField('has"quote')).toBe('"has""quote"');
    expect(csvField('has\nnewline')).toBe('"has\nnewline"');
  });

  it('writes nothing for null and undefined', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });
});
