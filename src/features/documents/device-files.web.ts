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

/** Returns a URL for the document; shareFile opens it in a new tab. */
export async function printToPdf(document: GeneratedDocument): Promise<string> {
  const blob = new Blob([document.html], { type: 'text/html' });
  return URL.createObjectURL(blob);
}

export async function writeCsv(estimate: EstimateRecord): Promise<string> {
  const blob = new Blob([renderEstimateCsv(estimate)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = `${estimateFileName(estimate)}.csv`;
  link.click();
  return url;
}

export interface ShareOptions {
  mimeType: string;
  dialogTitle: string;
}

export async function shareFile(uri: string, options: ShareOptions): Promise<boolean> {
  // The CSV was already downloaded by writeCsv.
  if (options.mimeType === 'text/csv') return true;
  window.open(uri, '_blank');
  return true;
}
