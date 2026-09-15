/**
 * The binary upload queue.
 *
 * Same queue machinery and same engine as the row outbox — the only differences
 * are the table it drains, that a transient failure does not block the line
 * (binaries have no dependencies on one another), and that some entries refuse
 * to run on a metered connection.
 *
 * Both photos and voice notes ride this queue, so every entry says which table
 * owns it. That is read off the queue entry rather than trusted from the
 * payload, so the two can never disagree.
 */

import type { PhotoVariant } from '../db/photos';
import { classifyPushError } from './classify';
import type { OutboxEntry, PushResult, SyncTransport } from './types';

export const UPLOAD_QUEUE_TABLE = 'upload_queue';

/** The tables whose rows own an uploadable binary. */
export type UploadOwner = 'photos' | 'voice_notes';

export interface UploadPayload {
  /** Which table the row lives in. Taken from the queue entry, not the payload. */
  entity: UploadOwner;
  /** The owning row's id. */
  recordId: string;
  variant: PhotoVariant;
  localUri: string;
  remotePath: string;
  contentType: string;
  /** Originals wait for Wi-Fi; a job can be 200 full-resolution photos. */
  requiresUnmetered: boolean;
}

export function readUploadPayload(entry: OutboxEntry): UploadPayload {
  const p = entry.payload as Partial<UploadPayload>;
  if (!p.recordId || !p.variant || !p.localUri || !p.remotePath) {
    throw new Error(`upload entry ${entry.seq} has an incomplete payload`);
  }
  if (entry.entity !== 'photos' && entry.entity !== 'voice_notes') {
    throw new Error(`upload entry ${entry.seq} belongs to ${entry.entity}, which has no binaries`);
  }
  return {
    entity: entry.entity,
    recordId: p.recordId,
    variant: p.variant,
    localUri: p.localUri,
    remotePath: p.remotePath,
    contentType: p.contentType ?? 'application/octet-stream',
    requiresUnmetered: p.requiresUnmetered ?? false,
  };
}

/** What actually moves the bytes. Storage on the phone, a fake in the tests. */
export interface BinaryUploader {
  upload(payload: UploadPayload): Promise<void>;
}

export interface UploadTransportOptions {
  /** False means cellular or a hotspot, so originals hold. */
  isUnmetered: () => boolean | Promise<boolean>;
  /** Called after each success, to record the path on the owning row. */
  onUploaded: (payload: UploadPayload) => Promise<void>;
  /** Called when an upload is given up on, to mark the row. */
  onFailed?: (payload: UploadPayload, message: string) => Promise<void>;
}

export function createUploadTransport(
  uploader: BinaryUploader,
  options: UploadTransportOptions,
): SyncTransport {
  return {
    async push(entry: OutboxEntry): Promise<PushResult> {
      let payload: UploadPayload;
      try {
        payload = readUploadPayload(entry);
      } catch (error) {
        // A malformed entry will never become valid. Park it.
        return { ok: false, kind: 'permanent', message: (error as Error).message };
      }

      if (payload.requiresUnmetered && !(await options.isUnmetered())) {
        // Not a failure — the contractor is on cellular and this is a 4 MB
        // original. Report it as transient so it simply waits for Wi-Fi.
        return { ok: false, kind: 'transient', message: 'waiting for an unmetered connection' };
      }

      try {
        await uploader.upload(payload);
      } catch (error) {
        const classified = classifyPushError(error);
        if (classified.kind === 'permanent') {
          await options.onFailed?.(payload, classified.message);
        }
        return { ok: false, ...classified };
      }

      await options.onUploaded(payload);
      return { ok: true };
    },
  };
}
