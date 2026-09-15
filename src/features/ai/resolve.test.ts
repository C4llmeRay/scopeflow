import { describe, expect, it } from 'vitest';

import { computeRoom } from '../../core/measure';
import { ft } from '../../core/units';
import type { PriceItemRecord } from '../../db/price-items';
import { QUANTITY_BASES, resolveQuantity, scopeSuggestionSchema } from './contract';
import {
  cleanDamages,
  cleanNarrative,
  cleanPhotoClassification,
  cleanVoiceExtraction,
  DISCARD_CONFIDENCE,
  LOW_CONFIDENCE,
  resolveScopeSuggestion,
} from './resolve';

/** The plan's worked example room. */
const quantities = computeRoom({
  lengthIn: ft(12),
  widthIn: ft(14),
  heightIn: ft(8),
  openings: [
    { kind: 'door', widthIn: 36, heightIn: 80 },
    { kind: 'window', widthIn: 48, heightIn: 36 },
  ],
  floodCutHeightIn: ft(2),
});

const MATERIALS = ['Carpet', 'Carpet pad', 'Drywall', 'Insulation', 'Baseboard'];

const price = (code: string, over: Partial<PriceItemRecord> = {}): PriceItemRecord => ({
  id: `p-${code}`,
  companyId: 'co-1',
  code,
  description: `${code} description`,
  unit: 'SF',
  category: 'Test',
  materialCostCents: 320,
  laborCostCents: 90,
  wastePct: 10,
  usefulLifeYears: 10,
  isSeed: false,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  ...over,
});

const PRICE_LIST = [
  price('FCC-CPT'),
  price('DRY-HTF'),
  price('BAS-RR', { unit: 'LF' }),
  price('DRY-FC2'),
];

describe('resolveQuantity — the model never supplies a number', () => {
  it('maps every basis to a field the measurement engine derived', () => {
    expect(resolveQuantity('floorSf', quantities)).toBe(168);
    expect(resolveQuantity('netWallSf', quantities)).toBe(384);
    expect(resolveQuantity('baseboardLf', quantities)).toBe(49);
    expect(resolveQuantity('floodCutSf', quantities)).toBe(104);
    expect(resolveQuantity('volumeCf', quantities)).toBe(1344);
  });

  it('treats a per-item line as a count of one, for a human to edit', () => {
    expect(resolveQuantity('each', quantities)).toBe(1);
  });

  it('covers every basis the schema advertises', () => {
    for (const basis of QUANTITY_BASES) {
      expect(Number.isFinite(resolveQuantity(basis, quantities)), basis).toBe(true);
    }
  });
});

describe('the schema cannot express a quantity', () => {
  it('offers no numeric quantity field at all', () => {
    const schema = scopeSuggestionSchema(['FCC-CPT']) as Record<string, never>;
    const lineProps = JSON.stringify(schema).match(/"properties":\{"code".*?\}\}/)?.[0] ?? '';
    expect(lineProps).not.toMatch(/"qty"|"quantity"|"amount"/);
    expect(JSON.stringify(schema)).toContain('"measure"');
  });

  it('restricts codes to the ones handed in', () => {
    const schema = JSON.stringify(scopeSuggestionSchema(['FCC-CPT', 'BAS-RR']));
    expect(schema).toContain('"FCC-CPT"');
    expect(schema).not.toContain('"DRY-HTF"');
  });
});

describe('resolveScopeSuggestion', () => {
  const suggest = (lines: unknown[], unpriced: unknown[] = []) => ({ lines, unpriced });

  it('takes quantities from geometry, not from the model', () => {
    const resolved = resolveScopeSuggestion(
      suggest([
        // The model tries to smuggle a number in. There is nowhere for it to go.
        { code: 'FCC-CPT', measure: 'floorSf', confidence: 0.9, reason: 'Carpet wet', qty: 99999 },
      ]),
      PRICE_LIST,
      quantities,
    );

    expect(resolved.lines).toHaveLength(1);
    expect(resolved.lines[0].qty).toBe(168);
  });

  it('drops a code the contractor does not have, and says which', () => {
    const resolved = resolveScopeSuggestion(
      suggest([
        { code: 'FCC-CPT', measure: 'floorSf', confidence: 0.9, reason: 'a' },
        { code: 'MADE-UP', measure: 'floorSf', confidence: 0.95, reason: 'b' },
      ]),
      PRICE_LIST,
      quantities,
    );

    expect(resolved.lines.map((l) => l.code)).toEqual(['FCC-CPT']);
    expect(resolved.rejectedCodes).toEqual(['MADE-UP']);
  });

  it('drops a line with an invented measure', () => {
    const resolved = resolveScopeSuggestion(
      suggest([{ code: 'FCC-CPT', measure: 'squareMetres', confidence: 0.9, reason: 'a' }]),
      PRICE_LIST,
      quantities,
    );
    expect(resolved.lines).toHaveLength(0);
    expect(resolved.rejectedCodes).toEqual(['FCC-CPT']);
  });

  it('drops a line measured against something this room does not have', () => {
    const noCut = computeRoom({ lengthIn: ft(12), widthIn: ft(14), heightIn: ft(8) });
    const resolved = resolveScopeSuggestion(
      suggest([{ code: 'DRY-FC2', measure: 'floodCutSf', confidence: 0.9, reason: 'a' }]),
      PRICE_LIST,
      noCut,
    );
    expect(resolved.lines).toHaveLength(0);
    expect(resolved.zeroQuantity).toEqual(['DRY-FC2']);
  });

  it('copies the price from the list, never from the model', () => {
    const resolved = resolveScopeSuggestion(
      suggest([
        {
          code: 'FCC-CPT', measure: 'floorSf', confidence: 0.9, reason: 'a',
          materialUnitCents: 1, laborUnitCents: 1, unit: 'ACRE',
        },
      ]),
      PRICE_LIST,
      quantities,
    );
    expect(resolved.lines[0]).toMatchObject({
      materialUnitCents: 320,
      laborUnitCents: 90,
      unit: 'SF',
      wastePct: 10,
      priceItemId: 'p-FCC-CPT',
    });
  });

  it('discards anything the model was barely confident about', () => {
    const resolved = resolveScopeSuggestion(
      suggest([
        { code: 'FCC-CPT', measure: 'floorSf', confidence: 0.9, reason: 'a' },
        { code: 'BAS-RR', measure: 'baseboardLf', confidence: 0.1, reason: 'b' },
      ]),
      PRICE_LIST,
      quantities,
    );
    expect(resolved.lines.map((l) => l.code)).toEqual(['FCC-CPT']);
  });

  it('flags a shaky suggestion rather than hiding it', () => {
    const resolved = resolveScopeSuggestion(
      suggest([{ code: 'FCC-CPT', measure: 'floorSf', confidence: 0.45, reason: 'a' }]),
      PRICE_LIST,
      quantities,
    );
    expect(resolved.lines[0].lowConfidence).toBe(true);
    expect(LOW_CONFIDENCE).toBeGreaterThan(DISCARD_CONFIDENCE);
  });

  it('clamps a nonsense confidence into range', () => {
    const resolved = resolveScopeSuggestion(
      suggest([{ code: 'FCC-CPT', measure: 'floorSf', confidence: 42, reason: 'a' }]),
      PRICE_LIST,
      quantities,
    );
    expect(resolved.lines[0].confidence).toBe(1);
  });

  it('keeps one line per code when the model repeats itself', () => {
    const resolved = resolveScopeSuggestion(
      suggest([
        { code: 'FCC-CPT', measure: 'floorSf', confidence: 0.9, reason: 'a' },
        { code: 'fcc-cpt', measure: 'ceilingSf', confidence: 0.8, reason: 'b' },
      ]),
      PRICE_LIST,
      quantities,
    );
    expect(resolved.lines).toHaveLength(1);
    expect(resolved.lines[0].measure).toBe('floorSf');
  });

  it('passes along work the model could not price', () => {
    const resolved = resolveScopeSuggestion(
      suggest([], ['Cabinet refinishing', 'Asbestos testing']),
      PRICE_LIST,
      quantities,
    );
    expect(resolved.unpriced).toEqual(['Cabinet refinishing', 'Asbestos testing']);
  });

  it('survives a response that is not the shape it promised', () => {
    for (const junk of [null, undefined, 'a string', 42, [], { lines: 'nope' }]) {
      const resolved = resolveScopeSuggestion(junk, PRICE_LIST, quantities);
      expect(resolved.lines).toEqual([]);
    }
  });

  it('returns nothing when the price list is empty', () => {
    const resolved = resolveScopeSuggestion(
      suggest([{ code: 'FCC-CPT', measure: 'floorSf', confidence: 0.9, reason: 'a' }]),
      [],
      quantities,
    );
    expect(resolved.lines).toEqual([]);
    expect(resolved.rejectedCodes).toEqual(['FCC-CPT']);
  });
});

describe('cleanDamages', () => {
  it('keeps a well-formed finding', () => {
    const cleaned = cleanDamages(
      [{ material: 'Drywall', affectedHeightIn: 14, confidence: 0.82, observation: 'Staining' }],
      MATERIALS,
    );
    expect(cleaned).toEqual([
      {
        material: 'Drywall',
        affectedHeightIn: 14,
        confidence: 0.82,
        observation: 'Staining',
        lowConfidence: false,
      },
    ]);
  });

  it('drops a material the contractor taxonomy does not have', () => {
    expect(cleanDamages([{ material: 'Unobtainium', confidence: 0.9 }], MATERIALS)).toEqual([]);
  });

  it('matches a material case-insensitively but stores the canonical spelling', () => {
    const cleaned = cleanDamages([{ material: 'drywall', confidence: 0.9 }], MATERIALS);
    expect(cleaned[0].material).toBe('Drywall');
  });

  it('keeps one finding per material', () => {
    const cleaned = cleanDamages(
      [
        { material: 'Drywall', confidence: 0.9, affectedHeightIn: 14 },
        { material: 'Drywall', confidence: 0.8, affectedHeightIn: 20 },
      ],
      MATERIALS,
    );
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].affectedHeightIn).toBe(14);
  });

  it('rejects an implausible water line rather than storing it', () => {
    for (const height of [-5, 0, 500, Number.NaN, 'high']) {
      const cleaned = cleanDamages(
        [{ material: 'Drywall', confidence: 0.9, affectedHeightIn: height }],
        MATERIALS,
      );
      expect(cleaned[0].affectedHeightIn, String(height)).toBeNull();
    }
  });

  it('rounds a fractional water line to a whole inch', () => {
    const cleaned = cleanDamages(
      [{ material: 'Drywall', confidence: 0.9, affectedHeightIn: 14.6 }],
      MATERIALS,
    );
    expect(cleaned[0].affectedHeightIn).toBe(15);
  });

  it('survives junk in the array', () => {
    const cleaned = cleanDamages(
      [null, 'nope', 42, { material: 'Carpet', confidence: 0.9 }],
      MATERIALS,
    );
    expect(cleaned).toHaveLength(1);
  });
});

describe('cleanPhotoClassification', () => {
  it('reads a complete classification', () => {
    const cleaned = cleanPhotoClassification(
      {
        damages: [{ material: 'Carpet', confidence: 0.9, observation: 'Soaked' }],
        waterCategory: 'cat_2',
        waterClass: 'class_2',
        caption: 'Carpet saturated wall to wall',
        noDamageVisible: false,
      },
      MATERIALS,
    );
    expect(cleaned.waterCategory).toBe('cat_2');
    expect(cleaned.waterClass).toBe('class_2');
    expect(cleaned.damages).toHaveLength(1);
    expect(cleaned.noDamageVisible).toBe(false);
  });

  it('rejects a category or class outside the standard', () => {
    const cleaned = cleanPhotoClassification(
      { damages: [{ material: 'Carpet', confidence: 0.9 }], waterCategory: 'cat_9', waterClass: 'wet' },
      MATERIALS,
    );
    expect(cleaned.waterCategory).toBeNull();
    expect(cleaned.waterClass).toBeNull();
  });

  it('reports no damage when everything was discarded', () => {
    const cleaned = cleanPhotoClassification(
      { damages: [{ material: 'Carpet', confidence: 0.05 }], noDamageVisible: false },
      MATERIALS,
    );
    expect(cleaned.damages).toEqual([]);
    expect(cleaned.noDamageVisible).toBe(true);
  });

  it('survives a response that is not an object', () => {
    const cleaned = cleanPhotoClassification('nope', MATERIALS);
    expect(cleaned.damages).toEqual([]);
    expect(cleaned.noDamageVisible).toBe(true);
  });
});

describe('cleanVoiceExtraction', () => {
  it('reads damages and side notes out of a transcript result', () => {
    const cleaned = cleanVoiceExtraction(
      {
        damages: [{ material: 'Drywall', confidence: 0.8, affectedHeightIn: 48 }],
        waterCategory: 'cat_2',
        waterClass: null,
        notes: ['Lockbox code is 4412', ''],
      },
      MATERIALS,
    );
    expect(cleaned.damages[0].affectedHeightIn).toBe(48);
    expect(cleaned.notes).toEqual(['Lockbox code is 4412']);
  });

  it('survives junk', () => {
    expect(cleanVoiceExtraction(null, MATERIALS).damages).toEqual([]);
  });
});

describe('cleanNarrative', () => {
  it('takes the text and trims it', () => {
    expect(cleanNarrative({ narrative: '  Supply line failure.  ' })).toBe('Supply line failure.');
  });

  it('caps a runaway narrative', () => {
    expect(cleanNarrative({ narrative: 'x'.repeat(5000) })).toHaveLength(1200);
  });

  it('returns nothing for junk', () => {
    expect(cleanNarrative(null)).toBe('');
    expect(cleanNarrative({ narrative: 42 })).toBe('');
  });
});
