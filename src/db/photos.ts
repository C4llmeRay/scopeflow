/**
 * The photos repository.
 *
 * Photos are evidence, and that shapes every decision here:
 *
 *   * The original file is never re-encoded. EXIF, GPS and the capture
 *     timestamp stay on it, because eighteen months later in a disputed claim
 *     that metadata is the contractor's defence.
 *   * A compressed derivative is uploaded immediately so the UI has something
 *     to show; the original waits for an unmetered connection.
 *   * Rows are append-only from the server's point of view. A deleted photo is
 *     soft-deleted, never purged.
 *
 * The row and the two binaries travel on different queues: the row on the
 * outbox, the binaries on the upload queue, so a 4 MB original on one bar of
 * signal never holds up the rooms queued behind it.
 */

import { iso, patchRecord, softDeleteRecord, upsertRecord } from './repository';
import type { LocalDatabase } from './types';

export type UploadState = 'pending' | 'uploading' | 'uploaded' | 'failed';
export type PhotoVariant = 'thumb' | 'original';

export interface PhotoRecord {
  id: string;
  companyId: string;
  jobId: string;
  roomId: string | null;
  localUri: string | null;
  localThumbUri: string | null;
  storagePath: string | null;
  thumbPath: string | null;
  takenAt: number | null;
  gpsLat: number | null;
  gpsLng: number | null;
  caption: string | null;
  aiLabels: Record<string, unknown>;
  uploadState: UploadState;
  originalState: UploadState;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface CapturePhotoInput {
  id: string;
  companyId: string;
  jobId: string;
  roomId?: string | null;
  /** The untouched original on the device. */
  localUri: string;
  /** The compressed derivative generated at capture time. */
  localThumbUri?: string | null;
  takenAt?: number | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
  caption?: string | null;
}

interface PhotoRow {
  id: string;
  company_id: string;
  job_id: string;
  room_id: string | null;
  local_uri: string | null;
  local_thumb_uri: string | null;
  storage_path: string | null;
  thumb_path: string | null;
  taken_at: number | null;
  gps_lat: number | null;
  gps_lng: number | null;
  caption: string | null;
  ai_labels: string;
  upload_state: string;
  original_state: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function toRecord(row: PhotoRow): PhotoRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    jobId: row.job_id,
    roomId: row.room_id,
    localUri: row.local_uri,
    localThumbUri: row.local_thumb_uri,
    storagePath: row.storage_path,
    thumbPath: row.thumb_path,
    takenAt: row.taken_at,
    gpsLat: row.gps_lat,
    gpsLng: row.gps_lng,
    caption: row.caption,
    aiLabels: JSON.parse(row.ai_labels) as Record<string, unknown>,
    uploadState: row.upload_state as UploadState,
    originalState: row.original_state as UploadState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/** Storage keys are derived, never stored, so they cannot drift from the row. */
export function storagePathFor(photo: { companyId: string; jobId: string; id: string }, variant: PhotoVariant): string {
  return `${photo.companyId}/${photo.jobId}/${photo.id}-${variant}.jpg`;
}

/** The queue key for one binary. A photo has two, so the variant is part of it. */
export const uploadKey = (photoId: string, variant: PhotoVariant): string =>
  `${photoId}:${variant}`;

/**
 * Records a captured photo and queues everything it needs: the row on the
 * outbox, the derivative and the original on the upload queue. Returns as soon
 * as SQLite has it — the camera must never wait on a network call.
 */
export async function capturePhoto(
  db: LocalDatabase,
  input: CapturePhotoInput,
  now: number = Date.now(),
): Promise<PhotoRecord> {
  const takenAt = input.takenAt ?? now;

  await upsertRecord(
    db,
    {
      entity: 'photos',
      id: input.id,
      companyId: input.companyId,
      columns: {
        job_id: input.jobId,
        room_id: input.roomId ?? null,
        local_uri: input.localUri,
        local_thumb_uri: input.localThumbUri ?? null,
        storage_path: null,
        thumb_path: null,
        taken_at: takenAt,
        gps_lat: input.gpsLat ?? null,
        gps_lng: input.gpsLng ?? null,
        caption: input.caption ?? null,
        ai_labels: '{}',
        upload_state: 'pending',
        original_state: 'pending',
      },
      // Paths on this phone mean nothing to the server, and the server tracks
      // its own upload state from the paths it actually receives.
      localOnly: ['local_uri', 'local_thumb_uri', 'original_state'],
      payloadOverrides: { ai_labels: {}, taken_at: iso(takenAt) },
    },
    now,
  );

  const target = { companyId: input.companyId, jobId: input.jobId, id: input.id };

  // The derivative goes first and on any connection: it is what the UI shows.
  if (input.localThumbUri) {
    await db.uploads.enqueue(
      {
        entity: 'photos',
        entityId: uploadKey(input.id, 'thumb'),
        op: 'upsert',
        payload: {
          recordId: input.id,
          variant: 'thumb',
          localUri: input.localThumbUri,
          remotePath: storagePathFor(target, 'thumb'),
          contentType: 'image/jpeg',
          requiresUnmetered: false,
        },
      },
      now,
    );
  }

  // The original waits for Wi-Fi. A job can be 200 full-resolution photos.
  await db.uploads.enqueue(
    {
      entity: 'photos',
      entityId: uploadKey(input.id, 'original'),
      op: 'upsert',
      payload: {
        recordId: input.id,
        variant: 'original',
        localUri: input.localUri,
        remotePath: storagePathFor(target, 'original'),
        contentType: 'image/jpeg',
        requiresUnmetered: true,
      },
    },
    now,
  );

  // Queued, never awaited: the shutter must not wait on a model. This runs
  // after the row has synced, because the Edge Function checks the job first.
  if (db.ai) {
    const { queuePhotoClassification } = await import('../features/ai/queue');
    await queuePhotoClassification(db.ai, { photoId: input.id, jobId: input.jobId }, now);
  }

  const photo = await getPhoto(db, input.id);
  if (!photo) throw new Error(`photo ${input.id} vanished immediately after being saved`);
  return photo;
}

/** Called by the upload queue once a binary has landed in storage. */
export async function markVariantUploaded(
  db: LocalDatabase,
  photoId: string,
  variant: PhotoVariant,
  remotePath: string,
  now: number = Date.now(),
): Promise<void> {
  if (variant === 'thumb') {
    await patchRecord(
      db,
      'photos',
      photoId,
      { thumb_path: remotePath, upload_state: 'uploaded' },
      now,
    );
    return;
  }

  await patchRecord(db, 'photos', photoId, { storage_path: remotePath }, now);
  // original_state is local bookkeeping — the server infers it from the path —
  // so it is written outside the patch rather than smuggled into the payload.
  await db.adapter.run(`update photos set original_state = 'uploaded' where id = ?`, [photoId]);
}

export async function markVariantFailed(
  db: LocalDatabase,
  photoId: string,
  variant: PhotoVariant,
  now: number = Date.now(),
): Promise<void> {
  const column = variant === 'thumb' ? 'upload_state' : 'original_state';
  await db.adapter.run(`update photos set ${column} = 'failed', updated_at = ? where id = ?`, [
    now,
    photoId,
  ]);
}

export async function listPhotos(
  db: LocalDatabase,
  jobId: string,
  roomId?: string | null,
): Promise<PhotoRecord[]> {
  const rows =
    roomId === undefined
      ? await db.adapter.all<PhotoRow>(
          `select * from photos where job_id = ? and deleted_at is null order by taken_at`,
          [jobId],
        )
      : await db.adapter.all<PhotoRow>(
          roomId === null
            ? `select * from photos where job_id = ? and room_id is null and deleted_at is null order by taken_at`
            : `select * from photos where job_id = ? and room_id = ? and deleted_at is null order by taken_at`,
          roomId === null ? [jobId] : [jobId, roomId],
        );
  return rows.map(toRecord);
}

export async function getPhoto(db: LocalDatabase, id: string): Promise<PhotoRecord | null> {
  const [row] = await db.adapter.all<PhotoRow>(`select * from photos where id = ?`, [id]);
  return row ? toRecord(row) : null;
}

/** Re-tagging a photo to a different room, which happens constantly in the truck. */
export async function assignPhotoToRoom(
  db: LocalDatabase,
  photoId: string,
  roomId: string | null,
  now: number = Date.now(),
): Promise<void> {
  await patchRecord(db, 'photos', photoId, { room_id: roomId }, now);
}

export async function setPhotoCaption(
  db: LocalDatabase,
  photoId: string,
  caption: string | null,
  now: number = Date.now(),
): Promise<void> {
  await patchRecord(db, 'photos', photoId, { caption }, now);
}

export async function softDeletePhoto(
  db: LocalDatabase,
  id: string,
  now: number = Date.now(),
): Promise<void> {
  await softDeleteRecord(db, 'photos', id, now);
}

/** How many photos are still waiting on their binaries, for the sync chip. */
export async function pendingUploadCount(db: LocalDatabase, jobId: string): Promise<number> {
  const [row] = await db.adapter.all<{ n: number }>(
    `select count(*) as n from photos
      where job_id = ? and deleted_at is null
        and (upload_state <> 'uploaded' or original_state <> 'uploaded')`,
    [jobId],
  );
  return row?.n ?? 0;
}
