import { describe, expect, it } from 'vitest';

import { detectDelimiter, parseCsv } from './csv';
import {
  detectColumns,
  importPriceList,
  normalizeUnit,
  parseMoneyCents,
  parseNumber,
} from './import';

describe('parseCsv', () => {
  it('reads a plain file', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('strips the BOM Excel writes', () => {
    expect(parseCsv('﻿code,desc\nWTR,Extraction')[0]).toEqual(['code', 'desc']);
  });

  it('handles CRLF and a lone CR', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,b\r1,2')).toHaveLength(2);
  });

  it('keeps commas inside quoted fields', () => {
    expect(parseCsv('code,desc\nDRY,"Hang, tape and float"')[1]).toEqual([
      'DRY',
      'Hang, tape and float',
    ]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('desc\n"He said ""wet"" twice"')[1]).toEqual(['He said "wet" twice']);
  });

  it('keeps newlines inside quoted fields', () => {
    const rows = parseCsv('code,notes\nDRY,"line one\nline two"');
    expect(rows).toHaveLength(2);
    expect(rows[1][1]).toBe('line one\nline two');
  });

  it('trims unquoted fields but respects quoted whitespace', () => {
    expect(parseCsv('a,b\n  x  ,"  y  "')[1]).toEqual(['x', '  y  ']);
  });

  it('drops blank and trailing rows', () => {
    expect(parseCsv('a,b\n1,2\n\n\n')).toHaveLength(2);
    expect(parseCsv('a,b\n,,\n1,2')).toHaveLength(2);
  });

  it('keeps an empty field in the middle of a row', () => {
    expect(parseCsv('a,b,c\n1,,3')[1]).toEqual(['1', '', '3']);
  });

  it('detects a semicolon delimiter from a European export', () => {
    expect(detectDelimiter('code;desc;unit')).toBe(';');
    expect(parseCsv('code;desc\nWTR;Extraction')[1]).toEqual(['WTR', 'Extraction']);
  });

  it('is not fooled by commas inside a quoted header', () => {
    expect(detectDelimiter('"last, first";age')).toBe(';');
  });

  it('detects tabs', () => {
    expect(parseCsv('a\tb\n1\t2')[1]).toEqual(['1', '2']);
  });

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n\n')).toEqual([]);
  });
});

describe('parseMoneyCents', () => {
  it('reads plain and decorated amounts', () => {
    expect(parseMoneyCents('3.20')).toBe(320);
    expect(parseMoneyCents('$3.20')).toBe(320);
    expect(parseMoneyCents('  $ 3.2 ')).toBe(320);
    expect(parseMoneyCents('1,234.56')).toBe(123_456);
    expect(parseMoneyCents('88')).toBe(8_800);
  });

  it('reads accounting negatives', () => {
    expect(parseMoneyCents('(5.00)')).toBe(-500);
  });

  it('returns null for blank and for text', () => {
    expect(parseMoneyCents('')).toBeNull();
    expect(parseMoneyCents('   ')).toBeNull();
    expect(parseMoneyCents(undefined)).toBeNull();
    expect(parseMoneyCents('call for price')).toBeNull();
    expect(parseMoneyCents('N/A')).toBeNull();
  });

  it('does not lose a half cent to float error', () => {
    expect(parseMoneyCents('1.005')).toBe(101);
    expect(parseMoneyCents('0.145')).toBe(15);
  });
});

describe('parseNumber', () => {
  it('reads percentages with or without the sign', () => {
    expect(parseNumber('10')).toBe(10);
    expect(parseNumber('10%')).toBe(10);
    expect(parseNumber('7.5 %')).toBe(7.5);
  });

  it('returns null for text and blanks', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('none')).toBeNull();
  });
});

describe('normalizeUnit', () => {
  it('folds the spellings a contractor uses', () => {
    for (const input of ['SF', 'sf', 'Sq Ft', 'square feet', 'SQFT']) {
      expect(normalizeUnit(input), input).toBe('SF');
    }
    expect(normalizeUnit('linear feet')).toBe('LF');
    expect(normalizeUnit('day')).toBe('DA');
    expect(normalizeUnit('each')).toBe('EA');
    expect(normalizeUnit('hrs')).toBe('HR');
  });

  it('passes an unknown unit through, uppercased', () => {
    expect(normalizeUnit('roll')).toBe('ROLL');
  });
});

describe('detectColumns', () => {
  it('finds the obvious names', () => {
    expect(detectColumns(['Code', 'Description', 'Unit', 'Unit Cost'])).toEqual({
      code: 0,
      description: 1,
      unit: 2,
      unitCost: 3,
    });
  });

  it('finds the aliases contractors actually use', () => {
    const map = detectColumns(['SKU', 'Activity', 'UOM', 'Trade', 'Material $', 'Labor $']);
    expect(map).toMatchObject({
      code: 0,
      description: 1,
      unit: 2,
      category: 3,
      materialCost: 4,
      laborCost: 5,
    });
  });

  it('prefers a specific material column over the generic cost fallback', () => {
    const map = detectColumns(['Code', 'Desc', 'Unit', 'Material Cost', 'Labour Cost']);
    expect(map.materialCost).toBe(3);
    expect(map.laborCost).toBe(4);
    expect(map.unitCost).toBeUndefined();
  });

  it('ignores case, underscores and stray punctuation', () => {
    const map = detectColumns(['ITEM_CODE', 'item description', 'U.O.M', 'PRICE']);
    expect(map).toMatchObject({ code: 0, description: 1, unitCost: 3 });
  });

  it('never assigns one column to two roles', () => {
    const map = detectColumns(['Code', 'Description', 'Unit', 'Cost']);
    const indices = Object.values(map);
    expect(new Set(indices).size).toBe(indices.length);
  });
});

describe('importPriceList', () => {
  const split = [
    'Code,Description,Unit,Category,Material Cost,Labor Cost,Waste %,Useful Life',
    'FCC-CPT,"Carpet with pad, replace",SF,Flooring,$3.20,$0.90,10,10',
    'DRY-HTF,"Drywall hang, tape, float",SF,Drywall,1.30,1.44,10,50',
    'EQP-DEH,Dehumidifier per day,DA,Equipment,0,88.00,0,',
  ].join('\n');

  it('imports a well-formed split list', () => {
    const result = importPriceList(split);

    expect(result.problems).toEqual([]);
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toEqual({
      code: 'FCC-CPT',
      description: 'Carpet with pad, replace',
      unit: 'SF',
      category: 'Flooring',
      materialCostCents: 320,
      laborCostCents: 90,
      wastePct: 10,
      usefulLifeYears: 10,
      unsplit: false,
    });
  });

  it('reports the mapping it guessed, so the screen can confirm it', () => {
    const result = importPriceList(split);
    expect(result.mapping).toMatchObject({ code: 0, materialCost: 4, laborCost: 5 });
    expect(result.headers[0]).toBe('Code');
  });

  it('puts an unsplit price in labor and says how many', () => {
    const text = ['Item,Description,UOM,Price', 'WTR-EXT,Water extraction,SF,0.62'].join('\n');
    const result = importPriceList(text);

    expect(result.items[0]).toMatchObject({
      materialCostCents: 0,
      laborCostCents: 62,
      unsplit: true,
    });
    expect(result.unsplitCount).toBe(1);
  });

  it('normalises units on the way in', () => {
    const text = ['Code,Desc,Unit,Price', 'X,Thing,square feet,1.00'].join('\n');
    expect(importPriceList(text).items[0].unit).toBe('SF');
  });

  it('skips rows missing a code, description, unit or price', () => {
    const text = [
      'Code,Description,Unit,Price',
      ',No code,SF,1.00',
      'B,,SF,1.00',
      'C,No unit,,1.00',
      'D,No price,SF,',
      'E,Good,SF,1.00',
    ].join('\n');

    const result = importPriceList(text);
    expect(result.items.map((i) => i.code)).toEqual(['E']);
    expect(result.problems).toHaveLength(4);
    expect(result.problems[0]).toMatchObject({ line: 2 });
    expect(result.problems[1].message).toMatch(/no description/);
  });

  it('points at the right line number, counting the header', () => {
    const text = ['Code,Description,Unit,Price', 'A,Good,SF,1.00', 'B,Bad,SF,zzz'].join('\n');
    expect(importPriceList(text).problems[0].line).toBe(3);
  });

  it('rejects a negative price rather than importing a credit', () => {
    const text = ['Code,Description,Unit,Price', 'A,Refund,SF,(5.00)'].join('\n');
    const result = importPriceList(text);
    expect(result.items).toHaveLength(0);
    expect(result.problems[0].message).toMatch(/negative/);
  });

  it('lets a later duplicate correct an earlier row', () => {
    const text = [
      'Code,Description,Unit,Price',
      'A,Old price,SF,1.00',
      'A,New price,SF,2.00',
    ].join('\n');

    const result = importPriceList(text);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].laborCostCents).toBe(200);
    expect(result.duplicateCodes).toEqual(['A']);
  });

  it('treats codes as case-insensitive when de-duplicating', () => {
    const text = ['Code,Description,Unit,Price', 'a-1,One,SF,1.00', 'A-1,Two,SF,2.00'].join('\n');
    expect(importPriceList(text).items).toHaveLength(1);
  });

  it('ignores an out-of-range waste factor but keeps the item', () => {
    const text = ['Code,Description,Unit,Price,Waste %', 'A,Thing,SF,1.00,250'].join('\n');
    const result = importPriceList(text);
    expect(result.items[0].wastePct).toBe(0);
    expect(result.problems[0].message).toMatch(/waste of 250% ignored/);
  });

  it('explains what it could not find rather than importing nonsense', () => {
    const text = ['Widget,Thing,Blob', '1,2,3'].join('\n');
    const result = importPriceList(text);
    expect(result.items).toHaveLength(0);
    expect(result.problems[0].message).toMatch(/Could not find a column for/);
  });

  it('accepts a mapping chosen by hand when detection fails', () => {
    const text = ['Widget,Thing,Blob,Money', 'WTR-EXT,Extraction,SF,0.62'].join('\n');
    const result = importPriceList(text, {
      mapping: { code: 0, description: 1, unit: 2, unitCost: 3 },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].code).toBe('WTR-EXT');
  });

  it('handles an empty file without throwing', () => {
    const result = importPriceList('');
    expect(result.items).toEqual([]);
    expect(result.problems[0].message).toMatch(/empty/);
  });

  it('survives a real-world file with a BOM, CRLF and quoted commas', () => {
    const text =
      '﻿Item #,Item Description,UOM,Material,Labor\r\n' +
      'BAS-RR,"Baseboard, remove and replace",LF,$2.40,$1.45\r\n';

    const result = importPriceList(text);
    expect(result.problems).toEqual([]);
    expect(result.items[0]).toMatchObject({
      code: 'BAS-RR',
      description: 'Baseboard, remove and replace',
      unit: 'LF',
      materialCostCents: 240,
      laborCostCents: 145,
    });
  });
});
