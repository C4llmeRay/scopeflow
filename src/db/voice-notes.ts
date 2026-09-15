/**
 * The voice notes repository.
 *
 * Talking is several times faster than typing with gloves on, and it is how the
 * trade already communicates. Recording is local and instant; the audio rides
 * the upload queue and the transcript comes back on sync.
 */

import type { UploadState } from './photos';
import { patchRecord, softDeleteRecord, upsertRecord } from './repository';
import type { LocalDatabase } from './types';

export interface VoiceNoteRecord {
  id: string;
  companyId: string;
  jobId: string;
  roomId: string | null;
  localUri: string | null;
  storagePath: string | null;
  durationMs: number | null;
  transcript: string | null;
  uploadState: UploadState;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface SaveVoiceNoteInput {
  id: string;
  companyId: string;
  jobId: string;
  roomId?: string | null;
  localUri: string;
  durationMs?: number | null;
}

interface VoiceNoteRow {
  id: string;
  company_id: string;
  job_id: string;
  room_id: string | null;
  local_uri: string | null;
  storage_path: string | null;
  duration_ms: number | null;
  transcript: string | null;
  upload_state: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function toRecord(row: VoiceNoteRow): VoiceNoteRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    jobId: row.job_id,
    roomId: row.room_id,
    localUri: row.local_uri,
    storagePath: row.storage_path,
    durationMs: row.duration_ms,
    transcript: row.transcript,
    uploadState: row.upload_state as UploadState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export const voiceStoragePathFor = (note: {
  companyId: string;
  jobId: string;
  id: string;
}): string => `${note.companyId}/${note.jobId}/voice-${note.id}.m4a`;

export async function saveVoiceNote(
  db: LocalDatabase,
  input: SaveVoiceNoteInput,
  now: number = Date.now(),
): Promise<VoiceNoteRecord> {
  await upsertRecord(
    db,
    {
      entity: 'voice_notes',
      id: input.id,
      companyId: input.companyId,
      columns: {
        job_id: input.jobId,
        room_id: input.roomId ?? null,
        local_uri: input.localUri,
        storage_path: null,
        duration_ms: input.durationMs ?? null,
        transcript: null,
        upload_state: 'pending',
      },
      localOnly: ['local_uri'],
    },
    now,
  );

  // Audio is small and the transcript is blocked behind it, so unlike a photo
  // original it does not wait for Wi-Fi.
  await db.uploads.enqueue(
    {
      entity: 'voice_notes',
      entityId: `${input.id}:audio`,
      op: 'upsert',
      payload: {
        recordId: input.id,
        variant: 'original',
        localUri: input.localUri,
        remotePath: voiceStoragePathFor(input),
        contentType: 'audio/m4a',
        requiresUnmetered: false,
      },
    },
    now,
  );

  const note = await getVoiceNote(db, input.id);
  if (!note) throw new Error(`voice note ${input.id} vanished immediately after being saved`);
  return note;
}

export async function listVoiceNotes(
  db: LocalDatabase,
  jobId: string,
): Promise<VoiceNoteRecord[]> {
  const rows = await db.adapter.all<VoiceNoteRow>(
    `select * from voice_notes where job_id = ? and deleted_at is null order by created_at`,
    [jobId],
  );
  return rows.map(toRecord);
}

export async function getVoiceNote(
  db: LocalDatabase,
  id: string,
): Promise<VoiceNoteRecord | null> {
  const [row] = await db.adapter.all<VoiceNoteRow>(`select * from voice_notes where id = ?`, [id]);
  return row ? toRecord(row) : null;
}

/** Called by the upload queue once the audio has landed in storage. */
export async function markVoiceNoteUploaded(
  db: LocalDatabase,
  id: string,
  remotePath: string,
  now: number = Date.now(),
): Promise<void> {
  await patchRecord(
    db,
    'voice_notes',
    id,
    { storage_path: remotePath, upload_state: 'uploaded' },
    now,
  );
}

export async function markVoiceNoteFailed(
  db: LocalDatabase,
  id: string,
  now: number = Date.now(),
): Promise<void> {
  await db.adapter.run(
    `update voice_notes set upload_state = 'failed', updated_at = ? where id = ?`,
    [now, id],
  );
}

/** Filled in on sync, once the audio has been transcribed server-side. */
export async function setTranscript(
  db: LocalDatabase,
  id: string,
  transcript: string,
  now: number = Date.now(),
): Promise<void> {
  await patchRecord(db, 'voice_notes', id, { transcript }, now);
}

export async function softDeleteVoiceNote(
  db: LocalDatabase,
  id: string,
  now: number = Date.now(),
): Promise<void> {
  await softDeleteRecord(db, 'voice_notes', id, now);
}
