/**
 * The parts of document output that touch the device: files, PDF, share sheet.
 *
 * Split from generate.ts so the web build (device-files.web.ts) can swap them
 * for a browser tab and a download without the document builders knowing.
 */

import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import type { EstimateRecord } from '../../db/estimates';
import { estimateFileName } from './estimate-document';
import { renderEstimateCsv } from './estimate-csv';
import type { GeneratedDocument } from './generate';

export async function readAsDataUri(localUri: string): Promise<string> {
  return `data:image/jpeg;base64,${await new File(localUri).base64()}`;
}

/** Renders HTML to a PDF on the device and returns its file URI. */
export async function printToPdf(document: GeneratedDocument): Promise<string> {
  const { uri } = await Print.printToFileAsync({ html: document.html, base64: false });

  // expo-print names the file with a random uuid; rename it to something an
  // adjuster can find again in their downloads folder.
  try {
    const printed = new File(uri);
    const target = new File(Paths.cache, `${document.fileName}.pdf`);
    if (target.exists) target.delete();
    await printed.move(target);
    return target.uri;
  } catch {
    // Renaming is a nicety; the PDF itself is what matters.
    return uri;
  }
}

export async function writeCsv(estimate: EstimateRecord): Promise<string> {
  const target = new File(Paths.cache, `${estimateFileName(estimate)}.csv`);
  if (target.exists) target.delete();
  target.create();
  target.write(renderEstimateCsv(estimate));
  return target.uri;
}

export interface ShareOptions {
  mimeType: string;
  dialogTitle: string;
}

/**
 * Hands the file to the OS share sheet, which is where email, Messages and
 * every cloud drive already live. Building an email client into the app would
 * be worse in every way than using the one the contractor already signed into.
 */
export async function shareFile(uri: string, options: ShareOptions): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, {
    mimeType: options.mimeType,
    dialogTitle: options.dialogTitle,
    UTI: options.mimeType === 'application/pdf' ? 'com.adobe.pdf' : 'public.comma-separated-values-text',
  });
  return true;
}
