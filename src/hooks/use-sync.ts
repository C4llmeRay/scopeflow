import { File } from 'expo-file-system';
import * as Network from 'expo-network';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { openLocalDatabase } from '@/db/client';
import { markVariantFailed, markVariantUploaded } from '@/db/photos';
import { markVoiceNoteFailed, markVoiceNoteUploaded } from '@/db/voice-notes';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { SyncEngine } from '@/sync/engine';
import { createSupabaseTransport } from '@/sync/transport';
import { createUploadTransport, type BinaryUploader } from '@/sync/uploads';
import { applyPhotoClassification, applyVoiceExtraction } from '@/features/ai/apply';
import { createAiTransport } from '@/features/ai/queue';
import { peekCompanyId } from '@/features/auth/current';
import { newId } from '@/lib/id';

export interface SyncStatus {
  /** Rows waiting to sync. */
  pending: number;
  /** Binaries waiting to upload. */
  uploading: number;
  /** Photos waiting to be looked at by the model. */
  thinking: number;
  failed: number;
  online: boolean;
  draining: boolean;
}

const PHOTO_BUCKET = 'job-media';

/** Reads the local file and hands the bytes to Supabase Storage. */
function storageUploader(): BinaryUploader {
  return {
    async upload({ localUri, remotePath, contentType }) {
      // Straight to bytes — no base64 round trip through a JS string, which
      // matters when the original is several megabytes.
      const body = await new File(localUri).bytes();

      const { error } = await getSupabase()
        .storage.from(PHOTO_BUCKET)
        .upload(remotePath, body, { contentType, upsert: true });

      if (error) throw error;
    },
  };
}

/**
 * Drains both queues on a timer, when the app returns to the foreground, and on
 * demand. Never blocks a screen: callers read the counts and carry on.
 *
 * Rows go first. A contractor cares that the measurements are safe; the photos
 * can follow once the rows are through.
 */
export function useSync(intervalMs = 15_000): SyncStatus & { syncNow: () => void } {
  const [status, setStatus] = useState<SyncStatus>({
    pending: 0,
    uploading: 0,
    thinking: 0,
    failed: 0,
    online: true,
    draining: false,
  });
  const rowEngine = useRef<SyncEngine | null>(null);
  const fileEngine = useRef<SyncEngine | null>(null);
  const aiEngine = useRef<SyncEngine | null>(null);

  const syncNow = useCallback(async () => {
    const db = await openLocalDatabase();

    // Nobody signed in: every push would be refused by RLS and parked as a
    // permanent failure, which would need a manual requeue to recover from.
    // Better to hold the queue than to poison it.
    const readCounts = async (online: boolean) => {
      const [rows, files, ai] = await Promise.all([
        db.outbox.counts(),
        db.uploads.counts(),
        db.ai?.counts() ?? Promise.resolve({ pending: 0, failed: 0 }),
      ]);
      setStatus({
        pending: rows.pending,
        uploading: files.pending,
        thinking: ai.pending,
        failed: rows.failed + files.failed + ai.failed,
        online,
        draining: false,
      });
    };

    // Nobody signed in: every push would be refused by RLS and parked as a
    // permanent failure, which would then need a manual requeue to recover
    // from. Better to hold the queue than to poison it.
    const companyId = peekCompanyId();
    if (!companyId) {
      await readCounts(false);
      return;
    }

    // With no backend configured the app still works end to end — writes land
    // on the phone and queue up. There is nowhere for them to go, so a count
    // would only read as a backlog; the chip just says the work is saved.
    if (!isSupabaseConfigured()) {
      setStatus({ pending: 0, uploading: 0, thinking: 0, failed: 0, online: false, draining: false });
      return;
    }

    const isOnline = async () =>
      (await Network.getNetworkStateAsync()).isInternetReachable ?? false;

    rowEngine.current ??= new SyncEngine(db.outbox, createSupabaseTransport(getSupabase()), {
      isOnline,
    });

    fileEngine.current ??= new SyncEngine(
      db.uploads,
      createUploadTransport(storageUploader(), {
        isUnmetered: async () => {
          const state = await Network.getNetworkStateAsync();
          return state.type === Network.NetworkStateType.WIFI;
        },
        // Photos and voice notes share this queue, so the owning table decides
        // which row gets marked. Getting this wrong is silent: the bytes land
        // and the row never learns about it.
        onUploaded: (p) =>
          p.entity === 'voice_notes'
            ? markVoiceNoteUploaded(db, p.recordId, p.remotePath)
            : markVariantUploaded(db, p.recordId, p.variant, p.remotePath),
        onFailed: (p) =>
          p.entity === 'voice_notes'
            ? markVoiceNoteFailed(db, p.recordId)
            : markVariantFailed(db, p.recordId, p.variant),
      }),
      {
        isOnline,
        // One stuck photo must not hold up the others; binaries have no
        // dependencies between them.
        stopOnTransientFailure: false,
        // Binaries are big, so fewer per pass keeps the app responsive.
        maxEntriesPerPass: 20,
      },
    );

    // The AI queue is last on purpose. The Edge Function checks that the job
    // belongs to the caller, which it can only do once the job row has landed.
    if (db.ai) {
      aiEngine.current ??= new SyncEngine(
        db.ai,
        createAiTransport({
          db,
          companyId: companyId,
          readImageBase64: (uri) => new File(uri).base64(),
          applyClassification: async (photoId, raw) =>
            (await applyPhotoClassification(db, photoId, raw, newId, companyId)) !== null,
          applyExtraction: async (noteId, raw) =>
            (await applyVoiceExtraction(db, noteId, raw, newId, companyId)) !== null,
        }),
        {
          isOnline,
          // One unclassifiable photo must not hold up the rest.
          stopOnTransientFailure: false,
          // Vision calls are slow and cost money; a few per pass is plenty.
          maxEntriesPerPass: 5,
          // Fewer attempts than a row push: a photo the model keeps failing on
          // is not worth forty tries at a few cents each.
          maxAttempts: 4,
        },
      );
    }

    setStatus((s) => ({ ...s, draining: true }));
    const rows = await rowEngine.current.drain();
    await fileEngine.current.drain();
    if (rows.stop === 'drained' && aiEngine.current) {
      // Only once the rows are actually through.
      await aiEngine.current.drain();
    }
    await readCounts(rows.stop !== 'offline');
  }, []);

  useEffect(() => {
    void syncNow();
    const timer = setInterval(() => void syncNow(), intervalMs);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void syncNow();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [intervalMs, syncNow]);

  return { ...status, syncNow: () => void syncNow() };
}
