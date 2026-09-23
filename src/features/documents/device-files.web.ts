/**
 * Document output in a browser, for the web demo.
 *
 * A browser has no share sheet and expo-print cannot write a PDF file there, so
 * the estimate opens in its own tab — where the browser's print dialog already
 * does "Save as PDF" — and the CSV downloads. The documents are the same HTML
 * the phone renders to PDF.
 */

import type { EstimateRecord } from '../../db/estimates';
import { estimateFileName } from './estimate-document';
import { renderEstimateCsv } from './estimate-csv';
import type { GeneratedDocument } from './generate';

export async function readAsDataUri(localUri: string): Promise<string> {
  const blob = await (await fetch(localUri)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('could not read the photo'));
    reader.readAsDataURL(blob);
  });
}

/** What each object URL holds, so a blocked tab can fall back to an overlay. */
const contents = new Map<string, { html: string; title: string }>();

/** Returns a URL for the document; shareFile opens it in a new tab. */
export async function printToPdf(document: GeneratedDocument): Promise<string> {
  const blob = new Blob([document.html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  contents.set(url, { html: document.html, title: document.fileName });
  return url;
}

/**
 * Shows a document over the app. Used where a new tab is not allowed — an
 * embedded or sandboxed page, a strict popup blocker — so "Send" still shows
 * what the adjuster would receive.
 */
function showOverlay(html: string, title: string): void {
  const doc = window.document;
  const backdrop = doc.createElement('div');
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-label', title);
  backdrop.style.cssText =
    'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;' +
    'background:rgba(15,23,30,.72);padding:16px;gap:8px;';

  const bar = doc.createElement('div');
  bar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;' +
    'color:#fff;font:600 14px system-ui,sans-serif;';
  const label = doc.createElement('span');
  label.textContent = title;
  const close = doc.createElement('button');
  close.textContent = 'Close';
  close.style.cssText = 'font:600 14px system-ui,sans-serif;padding:8px 16px;border-radius:8px;' +
    'border:0;background:#fff;color:#0b3d4c;cursor:pointer;';
  close.onclick = () => backdrop.remove();
  bar.append(label, close);

  const frame = doc.createElement('iframe');
  frame.title = title;
  frame.srcdoc = html;
  frame.style.cssText = 'flex:1;width:100%;border:0;border-radius:8px;background:#fff;';

  backdrop.append(bar, frame);
  doc.body.append(backdrop);
  close.focus();
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!);
}

export async function writeCsv(estimate: EstimateRecord): Promise<string> {
  const blob = new Blob([renderEstimateCsv(estimate)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const name = `${estimateFileName(estimate)}.csv`;
  const csv = renderEstimateCsv(estimate);
  contents.set(url, {
    title: name,
    html: `<pre style="font:12px/1.5 ui-monospace,monospace;padding:16px;white-space:pre">${escapeHtml(csv)}</pre>`,
  });
  const link = window.document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  return url;
}

export interface ShareOptions {
  mimeType: string;
  dialogTitle: string;
}

export async function shareFile(uri: string, options: ShareOptions): Promise<boolean> {
  const content = contents.get(uri);
  // A download can be silently refused in a sandboxed page, so the CSV is
  // shown as well; a document opens in a tab where one is allowed.
  if (options.mimeType !== 'text/csv') {
    let opened: Window | null = null;
    try {
      opened = window.open(uri, '_blank');
    } catch {
      opened = null;
    }
    if (opened) return true;
  }
  if (content) showOverlay(content.html, content.title);
  return true;
}
