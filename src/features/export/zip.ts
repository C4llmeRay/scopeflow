/**
 * The ZIP that goes into Xactimate.
 *
 * One folder named after the job, the photos inside it numbered in photo-sheet
 * order and named by their titles, and the list of names and descriptions next
 * to them in two forms: text to read and copy from, CSV for a spreadsheet.
 * Stored, not compressed — JPEGs do not get smaller, and storing is fast.
 */

import { strToU8, zipSync, type Zippable } from 'fflate';

import {
  buildExportManifest,
  manifestCsv,
  manifestText,
  safeFileStem,
  type ExportEntry,
} from '../photos/labels';
import type { ExportJob } from './source';

export interface ExportResult {
  zip: Uint8Array;
  fileName: string;
  entries: ExportEntry[];
  /** Photos left out because their bytes were not reachable. */
  missing: ExportEntry[];
}

export async function buildXactimateZip(
  job: ExportJob,
  onProgress?: (done: number, total: number) => void,
): Promise<ExportResult> {
  const entries = buildExportManifest(job.rooms, job.photos);
  const byId = new Map(job.photos.map((p) => [p.id, p]));
  const folder = safeFileStem(job.title);
  const files: Zippable = {};
  const missing: ExportEntry[] = [];

  let done = 0;
  for (const entry of entries) {
    const load = byId.get(entry.photoId)?.load;
    try {
      if (!load) throw new Error('not reachable');
      files[`${folder}/${entry.fileName}`] = [await load(), { level: 0 }];
    } catch {
      missing.push(entry);
    }
    onProgress?.(++done, entries.length);
  }

  const included = entries.filter((e) => !missing.includes(e));
  files[`${folder}/Photo list.txt`] = strToU8(manifestText(job.title, included));
  files[`${folder}/Photo list.csv`] = strToU8(manifestCsv(included));

  return { zip: zipSync(files), fileName: `${folder} - photos.zip`, entries, missing };
}
