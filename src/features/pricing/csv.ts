/**
 * A CSV reader for files that came out of a contractor's spreadsheet.
 *
 * Real exports are messier than the format suggests: a UTF-8 BOM from Excel,
 * CRLF line endings, quoted fields containing commas and newlines, doubled
 * quotes inside quoted fields, trailing blank lines, and a stray semicolon
 * delimiter from a European locale.
 *
 * This follows RFC 4180 and tolerates the rest. It returns rows of raw strings
 * and nothing else — interpreting them is `import.ts`.
 */

export interface CsvOptions {
  /** Auto-detected from the header line when not given. */
  delimiter?: string;
}

const BOM = '﻿';

/** Excel writes ; in locales where , is the decimal separator. */
export function detectDelimiter(text: string): string {
  const firstLine = text.replace(BOM, '').split(/\r?\n/, 1)[0] ?? '';

  let best = ',';
  let bestCount = 0;
  for (const candidate of [',', ';', '\t', '|']) {
    // Count only delimiters outside quotes, so a description containing a
    // comma does not win the vote.
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const char = firstLine[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (char === candidate && !inQuotes) count++;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsv(text: string, options: CsvOptions = {}): string[][] {
  const source = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  const delimiter = options.delimiter ?? detectDelimiter(source);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;

  const endField = () => {
    // Only unquoted fields get trimmed; a quoted one meant its spaces.
    row.push(fieldWasQuoted ? field : field.trim());
    field = '';
    fieldWasQuoted = false;
  };

  const endRow = () => {
    endField();
    // Drop rows that are entirely empty — trailing newlines, spacer rows.
    if (row.some((value) => value !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i++) {
    const char = source[i];

    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      fieldWasQuoted = true;
      continue;
    }

    if (char === delimiter) {
      endField();
      continue;
    }

    if (char === '\r') {
      // CRLF and a lone CR both end the row.
      if (source[i + 1] === '\n') i++;
      endRow();
      continue;
    }

    if (char === '\n') {
      endRow();
      continue;
    }

    field += char;
  }

  // Whatever is left when the text runs out is the final row.
  if (field !== '' || row.length > 0) endRow();

  return rows;
}
