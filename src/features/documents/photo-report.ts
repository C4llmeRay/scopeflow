/**
 * The photo report.
 *
 * Grouped by room, captioned, timestamped — the documentation package that goes
 * alongside the estimate. Adjusters read this before they read the scope, and a
 * photo without a room and a timestamp is worth much less in a disagreement.
 *
 * The image source is supplied by the caller rather than derived here, because
 * it differs by destination: a PDF printed on the phone needs a data URI, while
 * a hosted link needs a remote URL. Same template either way.
 */

import type { CompanyRecord } from '../../db/companies';
import { companyAddress } from '../../db/companies';
import { documentShell, esc, formatDate, joinParts } from './html';

export interface ReportPhoto {
  id: string;
  roomId: string | null;
  /** A data: URI for print, or an https URL for a hosted link. */
  src: string | null;
  caption: string | null;
  takenAt: number | null;
  gpsLat: number | null;
  gpsLng: number | null;
}

export interface ReportRoom {
  id: string;
  name: string;
}

export interface PhotoReportInput {
  company: CompanyRecord;
  job: {
    claimNo: string | null;
    carrier: string | null;
    dateOfLoss: string | null;
    propertyAddress1: string | null;
    homeownerName: string | null;
  };
  rooms: ReportRoom[];
  photos: ReportPhoto[];
  preparedAt: number;
}

/** A timestamp precise enough to matter in a claim dispute. */
export function photoStamp(photo: ReportPhoto): string {
  if (photo.takenAt === null) return '';
  const date = new Date(photo.takenAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Four decimal places is about 11 metres — enough to place a house. */
export function photoLocation(photo: ReportPhoto): string {
  if (photo.gpsLat === null || photo.gpsLng === null) return '';
  return `${photo.gpsLat.toFixed(4)}, ${photo.gpsLng.toFixed(4)}`;
}

interface PhotoGroup {
  name: string;
  photos: ReportPhoto[];
}

export function groupPhotosByRoom(input: PhotoReportInput): PhotoGroup[] {
  const groups: PhotoGroup[] = [];
  const byRoom = new Map<string, PhotoGroup>();

  for (const room of input.rooms) {
    const group = { name: room.name, photos: [] as ReportPhoto[] };
    byRoom.set(room.id, group);
    groups.push(group);
  }

  const untagged: PhotoGroup = { name: 'Not tagged to a room', photos: [] };

  // Oldest first, so the report reads in the order the walk happened.
  const ordered = [...input.photos].sort((a, b) => (a.takenAt ?? 0) - (b.takenAt ?? 0));
  for (const photo of ordered) {
    const group = photo.roomId ? byRoom.get(photo.roomId) : undefined;
    (group ?? untagged).photos.push(photo);
  }

  if (untagged.photos.length > 0) groups.push(untagged);
  return groups.filter((group) => group.photos.length > 0);
}

function renderPhoto(photo: ReportPhoto): string {
  const stamp = joinParts([photoStamp(photo), photoLocation(photo)], ' · ');
  return `<figure class="photo">
  ${
    photo.src
      ? `<img src="${esc(photo.src)}" alt="${esc(photo.caption ?? 'Damage photo')}">`
      : `<div class="img-missing"></div>`
  }
  ${photo.caption ? `<figcaption class="caption">${esc(photo.caption)}</figcaption>` : ''}
  ${stamp ? `<div class="stamp">${esc(stamp)}</div>` : ''}
</figure>`;
}

export function renderPhotoReport(input: PhotoReportInput): string {
  const { company, job } = input;
  const groups = groupPhotosByRoom(input);
  const total = groups.reduce((sum, group) => sum + group.photos.length, 0);

  const title = joinParts([company.name, job.propertyAddress1, 'Photo report'], ' — ');

  const facts = [
    ['Property', job.propertyAddress1],
    ['Insured', job.homeownerName],
    ['Carrier', job.carrier],
    ['Claim number', job.claimNo],
    ['Date of loss', formatDate(job.dateOfLoss)],
    ['Photographs', String(total)],
  ]
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => `<div class="fact"><span class="label">${esc(label)}</span>${esc(value)}</div>`)
    .join('\n');

  const body = `
<header class="letterhead">
  <div>
    <div class="company">${esc(company.name)}</div>
    <div class="small muted">${esc(companyAddress(company))}</div>
    <div class="small muted">${esc(joinParts([company.phone, company.email]))}</div>
  </div>
  <div class="right">
    <h1>Photo report</h1>
    <div class="small muted">Prepared ${esc(formatDate(input.preparedAt))}</div>
  </div>
</header>

<div class="facts">${facts}</div>

${
  groups.length === 0
    ? '<p class="muted">No photographs on this job.</p>'
    : groups
        .map(
          (group) => `<section class="room">
  <h2>${esc(group.name)}</h2>
  <div class="small muted">${esc(group.photos.length)} ${group.photos.length === 1 ? 'photograph' : 'photographs'}</div>
  <div class="photo-grid">${group.photos.map(renderPhoto).join('\n')}</div>
</section>`,
        )
        .join('\n')
}

<footer class="doc-footer">
  <span>${esc(company.name)}${job.claimNo ? ` · Claim ${esc(job.claimNo)}` : ''}</span>
  <span>Photographs carry their original capture time${
    input.photos.some((p) => p.gpsLat !== null) ? ' and location' : ''
  }.</span>
</footer>`;

  return documentShell({ title, body });
}
