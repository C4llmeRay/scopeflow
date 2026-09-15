/**
 * The AI work queue.
 *
 * A third queue on the same machinery as the row outbox and the upload queue.
 * Classification is queued at the moment of capture and drained later, because
 * a contractor pressing the shutter must never wait on a model.
 *
 * ORDERING MATTERS. The Edge Function checks that the job belongs to the
 * caller's company, which it can only do once the job row has reached the
 * server. So the queues drain in order — rows, then binaries, then AI — and
 * this one is the only one that genuinely cannot work offline.
 */

import type { LocalDatabase } from '../../db/types';
import { classifyPhoto, extractVoice } from './client';
import type { OutboxEntry, OutboxStore, PushResult, SyncTransport } from '../../sync/types';

export const AI_QUEUE_TABLE = 'ai_queue';

export interface ClassifyPhotoTask {
  photoId: string;
  jobId: string;
}

export interface ExtractVoiceTask {
  voiceNoteId: string;
  jobId: string;
}

export function readClassifyTask(entry: OutboxEntry): ClassifyPhotoTask {
  const payload = entry.payload as Partial<ClassifyPhotoTask>;
  if (!payload.photoId || !payload.jobId) {
    throw new Error(`AI entry ${entry.seq} has an incomplete payload`);
  }
  return { photoId: payload.photoId, jobId: payload.jobId };
}

/** Queued at capture time. Coalesces, so re-queuing one photo is harmless. */
export async function queuePhotoClassification(
  uploads: OutboxStore,
  task: ClassifyPhotoTask,
  now: number = Date.now(),
): Promise<void> {
  await uploads.enqueue(
    { entity: 'photos', entityId: task.photoId, op: 'upsert', payload: { ...task } },
    now,
  );
}

export function readVoiceTask(entry: OutboxEntry): ExtractVoiceTask {
  const payload = entry.payload as Partial<ExtractVoiceTask>;
  if (!payload.voiceNoteId || !payload.jobId) {
    throw new Error(`AI entry ${entry.seq} has an incomplete payload`);
  }
  return { voiceNoteId: payload.voiceNoteId, jobId: payload.jobId };
}

/**
 * Queued when a transcript exists — which, with on-device recognition, is the
 * moment the contractor stops speaking.
 */
export async function queueVoiceExtraction(
  queue: OutboxStore,
  task: ExtractVoiceTask,
  now: number = Date.now(),
): Promise<void> {
  await queue.enqueue(
    { entity: 'voice_notes', entityId: task.voiceNoteId, op: 'upsert', payload: { ...task } },
    now,
  );
}

export interface AiTransportOptions {
  db: LocalDatabase;
  companyId: string;
  /** Reads the derivative off the device. Injected so the engine is testable. */
  readImageBase64: (localUri: string) => Promise<string>;
  /** Applies a classification. Returns false when the photo has gone. */
  applyClassification: (photoId: string, raw: unknown) => Promise<boolean>;
  /** Applies a voice extraction. Returns false when the note has gone. */
  applyExtraction: (voiceNoteId: string, raw: unknown) => Promise<boolean>;
}

/**
 * Runs one queued classification.
 *
 * Every failure is classified so the engine knows what to do with it: a missing
 * photo or a missing file is permanent — retrying cannot conjure the bytes —
 * while a budget refusal or a network failure is transient and comes back after
 * a backoff.
 */
export function createAiTransport(options: AiTransportOptions): SyncTransport {
  const { db, companyId } = options;

  return {
    async push(entry: OutboxEntry): Promise<PushResult> {
      // Photos and voice notes share this queue, so the entry says which.
      if (entry.entity === 'voice_notes') return pushVoice(entry, options);
      if (entry.entity !== 'photos') {
        return {
          ok: false,
          kind: 'permanent',
          message: `${entry.entity} has no AI work`,
        };
      }

      let task: ClassifyPhotoTask;
      try {
        task = readClassifyTask(entry);
      } catch (error) {
        return { ok: false, kind: 'permanent', message: (error as Error).message };
      }

      const { getPhoto } = await import('../../db/photos');
      const photo = await getPhoto(db, task.photoId);

      if (!photo || photo.deletedAt !== null) {
        return { ok: false, kind: 'permanent', message: 'that photo is gone' };
      }

      const source = photo.localThumbUri ?? photo.localUri;
      if (!source) {
        return { ok: false, kind: 'permanent', message: 'that photo has no local file' };
      }

      let imageBase64: string;
      try {
        imageBase64 = await options.readImageBase64(source);
      } catch {
        // The OS cleared the cached file. There is nothing to classify and
        // never will be.
        return { ok: false, kind: 'permanent', message: 'the photo file is no longer on disk' };
      }

      const { listDamages } = await import('../../db/damages');
      const known = photo.roomId ? await listDamages(db, photo.roomId) : [];

      try {
        const { getRoom } = await import('../../db/rooms');
        const room = photo.roomId ? await getRoom(db, photo.roomId) : null;

        const { result } = await classifyPhoto(db, companyId, task.jobId, imageBase64, {
          roomName: room?.name ?? null,
          knownMaterials: known.map((damage) => damage.material),
        });

        const applied = await options.applyClassification(task.photoId, result);
        if (!applied) {
          return { ok: false, kind: 'permanent', message: 'that photo went away mid-flight' };
        }
        return { ok: true };
      } catch (error) {
        // Everything the service can fail with is worth another try: a budget
        // refusal clears when the contractor raises the ceiling, a network
        // failure clears with signal, and a bad answer may not repeat. The
        // engine's attempt limit is what eventually parks a hopeless entry.
        return { ok: false, kind: 'transient', message: (error as Error).message };
      }
    },
  };
}

/**
 * Runs one queued voice extraction.
 *
 * A note with no transcript is permanently unusable here: on-device recognition
 * produces the transcript at the moment of recording, so if there is none, the
 * recogniser heard nothing and never will.
 */
async function pushVoice(
  entry: OutboxEntry,
  options: AiTransportOptions,
): Promise<PushResult> {
  const { db, companyId } = options;

  let task: ExtractVoiceTask;
  try {
    task = readVoiceTask(entry);
  } catch (error) {
    return { ok: false, kind: 'permanent', message: (error as Error).message };
  }

  const { getVoiceNote } = await import('../../db/voice-notes');
  const note = await getVoiceNote(db, task.voiceNoteId);

  if (!note || note.deletedAt !== null) {
    return { ok: false, kind: 'permanent', message: 'that note is gone' };
  }
  if (!note.transcript?.trim()) {
    return { ok: false, kind: 'permanent', message: 'that note has no transcript' };
  }

  try {
    const { getRoom } = await import('../../db/rooms');
    const room = note.roomId ? await getRoom(db, note.roomId) : null;

    const { result } = await extractVoice(
      db,
      companyId,
      task.jobId,
      note.transcript,
      room?.name ?? null,
    );

    const applied = await options.applyExtraction(task.voiceNoteId, result);
    if (!applied) {
      return { ok: false, kind: 'permanent', message: 'that note went away mid-flight' };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, kind: 'transient', message: (error as Error).message };
  }
}
