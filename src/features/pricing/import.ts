/**
 * Turning a contractor's price spreadsheet into price items.
 *
 * Nobody's list has the same headers. "Code" is also ITEM, SKU, Item #. "Unit
 * Cost" is also Price, Rate, Total. So the columns are matched by fuzzy name
 * rather than by position, the guess is returned to the UI for confirmation,
 * and a contractor can override any of it before committing.
 *
 * Nothing here touches the database. It reads text and returns drafts plus a
 * report, so the import screen can show exactly what is about to happen.
 */

import { dollarsToCents } from '../../core/units';
import { parseCsv } from './csv';

export type PriceColumn =
  | 'code'
  | 'description'
  | 'unit'
  | 'category'
  | 'materialCost'
  | 'laborCost'
  | 'unitCost'
  | 'wastePct'
  | 'usefulLifeYears';

export type ColumnMap = Partial<Record<PriceColumn, number>>;

export interface PriceItemDraft {
  code: string;
  description: string;
  unit: string;
  category: string | null;
  materialCostCents: number;
  laborCostCents: number;
  wastePct: number;
  usefulLifeYears: number | null;
  /**
   * True when the source had one price rather than a material/labor split, so
   * the whole amount went to labor and this item will be under-taxed until a
   * human splits it.
   */
  unsplit: boolean;
}

export interface ImportProblem {
  /** 1-based line in the file, counting the header. */
  line: number;
  message: string;
}

export interface ImportResult {
  items: PriceItemDraft[];
  problems: ImportProblem[];
  mapping: ColumnMap;
  headers: string[];
  /** Items whose price was not split into material and labor. */
  unsplitCount: number;
  /** Codes that appeared more than once; the last one wins. */
  duplicateCodes: string[];
}

/**
 * Header spellings seen in the wild, most specific first so that "material
 * cost" beats the bare "cost" fallback.
 */
const HEADER_PATTERNS: [PriceColumn, RegExp][] = [
  ['materialCost', /^(material|mat|materials)\s*(cost|price|rate|\$)?$/],
  ['laborCost', /^(labou?r|install)\s*(cost|price|rate|\$)?$/],
  ['usefulLifeYears', /^(useful\s*life|life|life\s*years|lifespan)/],
  ['wastePct', /^(waste|waste\s*%|waste\s*pct|waste\s*factor)/],
  ['code', /^(code|item\s*code|item\s*#?|sku|cat(egory)?\s*code|selector|id)$/],
  ['description', /^(desc(ription)?|item\s*desc(ription)?|name|activity|work)$/],
  ['unit', /^(unit|uom|unit\s*of\s*measure|units|measure)$/],
  ['category', /^(category|group|trade|section|type)$/],
  ['unitCost', /^(unit\s*cost|unit\s*price|price|rate|cost|total|amount|\$)$/],
];

const normalizeHeader = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function detectColumns(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const normalized = headers.map(normalizeHeader);

  for (const [column, pattern] of HEADER_PATTERNS) {
    if (map[column] !== undefined) continue;
    const index = normalized.findIndex((header, i) => {
      if (Object.values(map).includes(i)) return false;
      return pattern.test(header);
    });
    if (index >= 0) map[column] = index;
  }

  return map;
}

/** Units as the trade writes them, normalised to what the estimate uses. */
const UNIT_ALIASES: Record<string, string> = {
  sf: 'SF', sqft: 'SF', 'sq ft': 'SF', 'square feet': 'SF', 'square foot': 'SF', ft2: 'SF',
  lf: 'LF', 'lin ft': 'LF', 'linear feet': 'LF', 'linear foot': 'LF',
  sy: 'SY', 'sq yd': 'SY', 'square yard': 'SY',
  ea: 'EA', each: 'EA', item: 'EA',
  da: 'DA', day: 'DA', days: 'DA', dy: 'DA',
  hr: 'HR', hour: 'HR', hours: 'HR', hrs: 'HR',
  cf: 'CF', 'cubic feet': 'CF',
  wk: 'WK', week: 'WK',
  mo: 'MO', month: 'MO',
};

export function normalizeUnit(raw: string): string {
  const key = raw.toLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ').trim();
  return UNIT_ALIASES[key] ?? raw.trim().toUpperCase();
}

/**
 * Reads a money cell. Handles currency symbols, thousands separators, blank
 * cells, and parentheses for negatives, which a few accounting exports use.
 */
export function parseMoneyCents(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const negative = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed
    .replace(/^\((.*)\)$/, '$1')
    .replace(/[$£€\s]/g, '')
    .replace(/,/g, '');

  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return dollarsToCents(negative ? -value : value);
}

export function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const cleaned = raw.replace(/[%\s,]/g, '').trim();
  if (!cleaned) return null;
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export interface ImportOptions {
  /** Overrides the detected mapping, from the confirmation screen. */
  mapping?: ColumnMap;
}

export function importPriceList(text: string, options: ImportOptions = {}): ImportResult {
  const rows = parseCsv(text);
  const problems: ImportProblem[] = [];

  if (rows.length === 0) {
    return {
      items: [],
      problems: [{ line: 1, message: 'The file is empty.' }],
      mapping: {},
      headers: [],
      unsplitCount: 0,
      duplicateCodes: [],
    };
  }

  const headers = rows[0];
  const mapping = options.mapping ?? detectColumns(headers);

  const missing: string[] = [];
  if (mapping.code === undefined) missing.push('code');
  if (mapping.description === undefined) missing.push('description');
  if (mapping.unit === undefined) missing.push('unit');
  const hasPrice =
    mapping.unitCost !== undefined ||
    mapping.materialCost !== undefined ||
    mapping.laborCost !== undefined;
  if (!hasPrice) missing.push('a price');

  if (missing.length > 0) {
    return {
      items: [],
      problems: [
        {
          line: 1,
          message: `Could not find a column for ${missing.join(', ')}. Pick the columns by hand.`,
        },
      ],
      mapping,
      headers,
      unsplitCount: 0,
      duplicateCodes: [],
    };
  }

  const cell = (row: string[], column: PriceColumn): string | undefined => {
    const index = mapping[column];
    return index === undefined ? undefined : row[index];
  };

  const byCode = new Map<string, PriceItemDraft>();
  const seen = new Set<string>();
  const duplicateCodes: string[] = [];
  let unsplitCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const line = i + 1;

    const code = (cell(row, 'code') ?? '').trim();
    const description = (cell(row, 'description') ?? '').trim();
    const unitRaw = (cell(row, 'unit') ?? '').trim();

    if (!code) {
      problems.push({ line, message: 'No code — row skipped.' });
      continue;
    }
    if (!description) {
      problems.push({ line, message: `${code}: no description — row skipped.` });
      continue;
    }
    if (!unitRaw) {
      problems.push({ line, message: `${code}: no unit — row skipped.` });
      continue;
    }

    const material = parseMoneyCents(cell(row, 'materialCost'));
    const labor = parseMoneyCents(cell(row, 'laborCost'));
    const total = parseMoneyCents(cell(row, 'unitCost'));

    let materialCostCents: number;
    let laborCostCents: number;
    let unsplit = false;

    if (material !== null || labor !== null) {
      materialCostCents = material ?? 0;
      laborCostCents = labor ?? 0;
    } else if (total !== null) {
      // One price and no split. Everything goes to labor so the item is not
      // over-taxed; the caller warns, because it is now under-taxed instead.
      materialCostCents = 0;
      laborCostCents = total;
      unsplit = true;
    } else {
      problems.push({ line, message: `${code}: no readable price — row skipped.` });
      continue;
    }

    if (materialCostCents < 0 || laborCostCents < 0) {
      problems.push({ line, message: `${code}: negative price — row skipped.` });
      continue;
    }

    const waste = parseNumber(cell(row, 'wastePct'));
    if (waste !== null && (waste < 0 || waste > 100)) {
      problems.push({ line, message: `${code}: waste of ${waste}% ignored.` });
    }

    const life = parseNumber(cell(row, 'usefulLifeYears'));
    const category = (cell(row, 'category') ?? '').trim();

    const key = code.toUpperCase();
    if (seen.has(key)) {
      duplicateCodes.push(code);
      // The later row wins, which matches how a spreadsheet is usually fixed:
      // a correction pasted below the original.
    }
    seen.add(key);
    if (unsplit) unsplitCount++;

    byCode.set(key, {
      code,
      description,
      unit: normalizeUnit(unitRaw),
      category: category || null,
      materialCostCents,
      laborCostCents,
      wastePct: waste !== null && waste >= 0 && waste <= 100 ? waste : 0,
      usefulLifeYears: life !== null && life > 0 ? Math.round(life) : null,
      unsplit,
    });
  }

  return {
    items: [...byCode.values()],
    problems,
    mapping,
    headers,
    unsplitCount,
    duplicateCodes: [...new Set(duplicateCodes)],
  };
}
