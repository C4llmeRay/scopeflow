/**
 * Naming and describing photos for Xactimate.
 *
 * The contractor's real cost is not taking the photos — it is sitting at the
 * desk afterwards typing a title and a description into Xactimate for each of
 * sixty of them. So a photo is named while it is taken, from two taps: the
 * room it is in and what it shows. The description is written (or dictated
 * through the keyboard's microphone) on the phone, where the memory of the
 * room is fresh.
 *
 * Pure: no React, no database, so the export and the screens share one set of
 * rules and the tests pin them down.
 */

/** What a photo shows, in the words an adjuster reads on a photo sheet. */
export interface PhotoSubject {
  label: string;
  /** Sentence starters for the description, tapped rather than typed. */
  starters: readonly string[];
}

export const PHOTO_SUBJECTS: readonly PhotoSubject[] = [
  {
    label: 'Overview',
    starters: ['Overview of the room.', 'Overview showing the affected area.'],
  },
  {
    label: 'Front of risk',
    starters: ['Front elevation of the property.', 'House number visible.'],
  },
  {
    label: 'Source of loss',
    starters: ['Source of loss.', 'Failed supply line.', 'Leak located at'],
  },
  {
    label: 'Water line',
    starters: ['Water line visible on the wall at approx.', 'Wicking up the drywall to approx.'],
  },
  {
    label: 'Drywall',
    starters: ['Wet drywall.', 'Drywall swollen and stained.', 'Flood cut at'],
  },
  {
    label: 'Baseboard',
    starters: ['Baseboard swollen and separating.', 'Baseboard detached.'],
  },
  {
    label: 'Flooring',
    starters: ['Flooring saturated.', 'Flooring cupped and buckling.', 'Flooring lifted to expose subfloor.'],
  },
  {
    label: 'Carpet & pad',
    starters: ['Carpet and pad saturated.', 'Pad removed.', 'Carpet delaminating.'],
  },
  {
    label: 'Ceiling',
    starters: ['Ceiling stained.', 'Ceiling sagging.', 'Water dripping from ceiling.'],
  },
  {
    label: 'Cabinets',
    starters: ['Base cabinet toe kick swollen.', 'Cabinet interior wet.'],
  },
  {
    label: 'Moisture reading',
    starters: ['Moisture reading of', 'Dry standard reading of'],
  },
  {
    label: 'Contents',
    starters: ['Contents affected.', 'Contents moved for mitigation.'],
  },
  {
    label: 'Equipment',
    starters: ['Drying equipment in place.', 'Air movers and dehumidifier set.'],
  },
] as const;

/**
 * "Kitchen - Water line". Either half may be missing; with neither there is no
 * name yet, which is different from an empty one.
 */
export function composeTitle(roomName: string | null, subject: string | null): string | null {
  const room = roomName?.trim() || null;
  const what = subject?.trim() || null;
  if (room && what) return `${room} - ${what}`;
  return room ?? what;
}

/** Adds a starter to a description, as a new sentence, without doubling spaces. */
export function appendStarter(description: string, starter: string): string {
  const current = description.trim();
  if (!current) return starter;
  const joiner = /[.!?]$/.test(current) ? ' ' : '. ';
  return `${current}${joiner}${starter}`;
}

export interface LabelledPhoto {
  id: string;
  roomId: string | null;
  title: string | null;
  caption: string | null;
  takenAt: number | null;
}

/** Done means both halves are there: Xactimate wants a name and a description. */
export const isLabelled = (photo: Pick<LabelledPhoto, 'title' | 'caption'>): boolean =>
  Boolean(photo.title?.trim()) && Boolean(photo.caption?.trim());

export function labelProgress(photos: readonly Pick<LabelledPhoto, 'title' | 'caption'>[]): {
  labelled: number;
  total: number;
  remaining: number;
} {
  const labelled = photos.filter(isLabelled).length;
  return { labelled, total: photos.length, remaining: photos.length - labelled };
}

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

export interface ExportRoom {
  id: string;
  name: string;
  sortOrder: number;
}

export interface ExportEntry {
  /** 1-based position on the photo sheet. */
  number: number;
  photoId: string;
  fileName: string;
  roomName: string | null;
  title: string;
  description: string;
}

/** Windows refuses these in file names, and the file lands on a Windows PC. */
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;
const MAX_NAME = 80;

export function safeFileStem(text: string): string {
  const cleaned = text.replace(ILLEGAL, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return (cleaned.slice(0, MAX_NAME).trim() || 'Photo').replace(/[. ]+$/, '');
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/**
 * The order and names the photos go into Xactimate with.
 *
 * Photos with no room first — the front of the house and the source of loss are
 * what an adjuster expects to open with — then each room in the order it was
 * added, and within a room in the order the photos were taken. The number in
 * the file name keeps that order however the folder is sorted.
 */
export function buildExportManifest(
  rooms: readonly ExportRoom[],
  photos: readonly LabelledPhoto[],
): ExportEntry[] {
  const roomOrder = new Map(
    [...rooms].sort((a, b) => a.sortOrder - b.sortOrder).map((room, i) => [room.id, i]),
  );
  const roomName = new Map(rooms.map((room) => [room.id, room.name]));

  const rank = (photo: LabelledPhoto): number =>
    photo.roomId === null || !roomOrder.has(photo.roomId) ? -1 : roomOrder.get(photo.roomId)!;

  const ordered = [...photos].sort(
    (a, b) => rank(a) - rank(b) || (a.takenAt ?? 0) - (b.takenAt ?? 0) || a.id.localeCompare(b.id),
  );

  const width = Math.max(3, String(ordered.length).length);

  return ordered.map((photo, i) => {
    const room = photo.roomId ? (roomName.get(photo.roomId) ?? null) : null;
    const title = photo.title?.trim() || room || `Photo ${i + 1}`;
    return {
      number: i + 1,
      photoId: photo.id,
      fileName: `${pad(i + 1, width)} ${safeFileStem(title)}.jpg`,
      roomName: room,
      title,
      description: photo.caption?.trim() ?? '',
    };
  });
}

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** For a spreadsheet, or anything that wants the list as data. */
export function manifestCsv(entries: readonly ExportEntry[]): string {
  const header = ['No', 'File', 'Room', 'Title', 'Description'];
  const rows = entries.map((e) => [e.number, e.fileName, e.roomName ?? '', e.title, e.description]);
  // The BOM makes Excel read the file as UTF-8 rather than mangling accents.
  return '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** For reading next to Xactimate and copying from: one block per photo. */
export function manifestText(jobTitle: string, entries: readonly ExportEntry[]): string {
  const blocks = entries.map((e) =>
    [`${e.number}. ${e.fileName}`, `Title: ${e.title}`, `Description: ${e.description || '(none)'}`].join(
      '\r\n',
    ),
  );
  return [`${jobTitle} — ${entries.length} photos`, '', ...blocks.flatMap((b) => [b, ''])].join('\r\n');
}
