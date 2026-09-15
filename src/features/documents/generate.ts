/**
 * Turning stored data into a document a contractor can send.
 *
 * Deliberately on-device. The plan sketched a Playwright container for HTML to
 * PDF, and that is still the right answer for rendering a link server-side, but
 * expo-print does the same job locally — which means an estimate can be produced
 * and emailed from a driveway with no signal at all. That matches the product's
 * whole thesis better than a round trip does.
 */

import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { getCompany, type CompanyRecord } from '../../db/companies';
import type { LocalDatabase } from '../../db/types';
import { getEstimate, type EstimateRecord } from '../../db/estimates';
import { getJob } from '../../db/jobs';
import { listPhotos } from '../../db/photos';
import { listRooms } from '../../db/rooms';
import { estimateFileName, renderEstimateDocument } from './estimate-document';
import { renderEstimateCsv } from './estimate-csv';
import { renderPhotoReport, type ReportPhoto } from './photo-report';

export interface GeneratedDocument {
  html: string;
  /** Without an extension. */
  fileName: string;
}

export class MissingCompanyProfile extends Error {
  constructor() {
    super('Set up your company details before sending an estimate.');
    this.name = 'MissingCompanyProfile';
  }
}

async function requireCompany(db: LocalDatabase, companyId: string): Promise<CompanyRecord> {
  const company = await getCompany(db, companyId);
  if (!company) throw new MissingCompanyProfile();
  return company;
}

export async function buildEstimateDocument(
  db: LocalDatabase,
  estimateId: string,
): Promise<{ document: GeneratedDocument; estimate: EstimateRecord }> {
  const estimate = await getEstimate(db, estimateId);
  if (!estimate) throw new Error(`estimate ${estimateId} not found`);

  const company = await requireCompany(db, estimate.companyId);
  return {
    estimate,
    document: {
      html: renderEstimateDocument({ estimate, company }),
      fileName: estimateFileName(estimate),
    },
  };
}

/**
 * Photos are embedded as data URIs so the PDF stands alone. The compressed
 * derivative is used, never the original: a report of 200 full-resolution
 * photos would be hundreds of megabytes and would not send.
 */
async function toDataUri(localUri: string | null): Promise<string | null> {
  if (!localUri) return null;
  try {
    return `data:image/jpeg;base64,${await new File(localUri).base64()}`;
  } catch {
    // A file the OS has since cleared. Better a placeholder than a failed report.
    return null;
  }
}

export async function buildPhotoReportDocument(
  db: LocalDatabase,
  jobId: string,
  now: number = Date.now(),
): Promise<GeneratedDocument> {
  const job = await getJob(db, jobId);
  if (!job) throw new Error(`job ${jobId} not found`);

  const company = await requireCompany(db, job.companyId);
  const [rooms, photos] = await Promise.all([listRooms(db, jobId), listPhotos(db, jobId)]);

  const reportPhotos: ReportPhoto[] = [];
  for (const photo of photos) {
    reportPhotos.push({
      id: photo.id,
      roomId: photo.roomId,
      src: await toDataUri(photo.localThumbUri ?? photo.localUri),
      caption: photo.caption,
      takenAt: photo.takenAt,
      gpsLat: photo.gpsLat,
      gpsLng: photo.gpsLng,
    });
  }

  const html = renderPhotoReport({
    company,
    job: {
      claimNo: job.claimNo,
      carrier: job.carrier,
      dateOfLoss: job.dateOfLoss,
      propertyAddress1: job.propertyAddress1,
      homeownerName: job.homeownerName,
    },
    rooms: rooms.map((room) => ({ id: room.id, name: room.name })),
    photos: reportPhotos,
    preparedAt: now,
  });

  const base = (job.claimNo || job.propertyAddress1 || 'job')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();

  return { html, fileName: `${base}-photos` };
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
