/**
 * HTML building blocks shared by the estimate and the photo report.
 *
 * Everything that reaches a document came from a person typing into a phone:
 * homeowner names, room names, line notes, terms. All of it is escaped on the
 * way in. An estimate is emailed to an adjuster and hosted at a public link, so
 * an unescaped apostrophe is a broken document and an unescaped angle bracket
 * is an injection.
 */

/** Escapes text for HTML body and attribute contexts alike. */
export function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Joins the truthy parts of a line with a separator. */
export const joinParts = (parts: (string | null | undefined)[], sep = ' · '): string =>
  parts.filter((p) => p !== null && p !== undefined && String(p).trim() !== '').join(sep);

/** A date a person reads, from an ISO string or epoch millis. */
export function formatDate(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Print-first stylesheet.
 *
 * The same document is emailed as a PDF and opened as a link, so it has to hold
 * up on US Letter and on a phone. Colours stay conservative: an adjuster prints
 * these in black and white, and a document that depends on colour to be legible
 * stops being legible on their printer.
 */
export const DOCUMENT_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    padding: 32px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.45;
    color: #14202a;
    background: #ffffff;
  }
  h1, h2, h3 { margin: 0; line-height: 1.2; }
  /* A figure carries a 40px side margin by default, which silently shrinks
     every photo inside a grid cell. */
  figure, figcaption { margin: 0; }
  h1 { font-size: 22pt; letter-spacing: -0.01em; }
  h2 { font-size: 13pt; margin-top: 26px; }
  h3 { font-size: 11pt; }
  p { margin: 0 0 8px; }
  .muted { color: #5a6b75; }
  .small { font-size: 9pt; }
  .label {
    font-size: 8pt; text-transform: uppercase; letter-spacing: 0.09em;
    color: #6d7d87; font-weight: 700;
  }

  header.letterhead {
    display: flex; justify-content: space-between; align-items: flex-start;
    gap: 24px; padding-bottom: 16px; border-bottom: 2px solid #14202a;
  }
  .letterhead .company { font-size: 14pt; font-weight: 700; }
  .letterhead .right { text-align: right; }

  .facts {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px 24px; margin: 20px 0 8px;
  }
  .fact .label { display: block; margin-bottom: 2px; }

  table { width: 100%; border-collapse: collapse; margin: 10px 0 18px; }
  th {
    text-align: left; font-size: 8pt; text-transform: uppercase;
    letter-spacing: 0.08em; color: #6d7d87; font-weight: 700;
    padding: 6px 8px; border-bottom: 1.5px solid #14202a;
  }
  td { padding: 7px 8px; border-bottom: 1px solid #dfe5e9; vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tbody tr:last-child td { border-bottom: 1.5px solid #14202a; }

  .room { margin-top: 22px; page-break-inside: avoid; }
  .room-head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
  .room-dims { font-size: 9pt; color: #5a6b75; }

  /* Totals sit to the right the way an invoice does, with their heading
     attached rather than stranded across the page from the numbers. */
  .totals-block { margin-top: 22px; margin-left: auto; width: 340px; max-width: 100%; }
  .totals-block h2 { margin: 0 0 6px; }
  .totals { width: 100%; margin: 0; }
  .totals tr td { border: none; padding: 4px 0; }
  .totals tr.rule td { border-top: 1px solid #dfe5e9; padding-top: 8px; }
  .totals tr.grand td {
    border-top: 2px solid #14202a; padding-top: 10px;
    font-size: 13pt; font-weight: 700;
  }

  .note { font-size: 9pt; color: #5a6b75; }
  .terms { margin-top: 28px; padding-top: 14px; border-top: 1px solid #dfe5e9; }

  .photo-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px;
  }
  .photo { page-break-inside: avoid; }
  .photo img {
    width: 100%; height: 170px; object-fit: cover;
    border: 1px solid #dfe5e9; border-radius: 4px; background: #eef1f3;
  }
  .photo .caption { font-size: 9pt; margin-top: 4px; }
  .photo .stamp { font-size: 8pt; color: #6d7d87; }

  footer.doc-footer {
    margin-top: 30px; padding-top: 12px; border-top: 1px solid #dfe5e9;
    font-size: 8pt; color: #6d7d87;
    display: flex; justify-content: space-between; gap: 16px;
  }

  @page { size: letter; margin: 0.6in; }
  @media print { body { padding: 0; } .page-break { page-break-before: always; } }
  @media (max-width: 560px) {
    body { padding: 16px; font-size: 12pt; }
    header.letterhead { flex-direction: column; }
    .letterhead .right { text-align: left; }
    .totals-block { width: 100%; }
    table.lines { font-size: 10pt; }
  }
`;

export interface DocumentShell {
  title: string;
  body: string;
}

/** Wraps rendered body content in a complete, self-contained document. */
export function documentShell({ title, body }: DocumentShell): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${DOCUMENT_CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}
