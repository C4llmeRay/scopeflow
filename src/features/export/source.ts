/**
 * Where an export gets its job, rooms and photo bytes from.
 *
 * Two places, because the export happens in two places. On the phone, it is
 * the phone's own database and files. At the desk — where Xactimate is — the
 * browser has none of that: the photos were taken on another device, so the
 * job is read from Supabase and the photos downloaded from the bucket.
 */

import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { openLocalDatabase } from '../../db/client';
import { getJob, jobTitle } from '../../db/jobs';
import { listPhotos } from '../../db/photos';
import { listRooms } from '../../db/rooms';
import { getSupabase } from '../../lib/supabase';
import { decodeDataUri, isDataUri } from '../../sync/data-uri';
import type { ExportRoom, LabelledPhoto } from '../photos/labels';
import { PHOTO_BUCKET } from '../photos/source';

export interface ExportPhoto extends LabelledPhoto {
  /** For the on-screen preview, when there is something local to show. */
  previewUri: string | null;
  /** Null when the bytes are not reachable from here — not uploaded yet. */
  load: (() => Promise<Uint8Array>) | null;
}

export interface ExportJob {
  id: string;
  title: string;
  rooms: ExportRoom[];
  photos: ExportPhoto[];
}

async function readLocal(uri: string): Promise<Uint8Array> {
  if (isDataUri(uri)) return decodeDataUri(uri).bytes;
  if (Platform.OS === 'web') return new Uint8Array(await (await fetch(uri)).arrayBuffer());
  return new File(uri).bytes();
}

/**
 * From this device. On a phone the 1280-pixel copy is used, not the original:
 * a ZIP is built in memory, and sixty full-size photos would not fit.
 */
export async function loadLocalJob(jobId: string): Promise<ExportJob | null> {
  const db = await openLocalDatabase();
  const job = await getJob(db, jobId);
  if (!job) return null;
  const [rooms, photos] = await Promise.all([listRooms(db, jobId), listPhotos(db, jobId)]);

  return {
    id: job.id,
    title: jobTitle(job),
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, sortOrder: r.sortOrder })),
    photos: photos.map((p) => {
      const uri = Platform.OS === 'web' ? (p.localUri ?? p.localThumbUri) : (p.localThumbUri ?? p.localUri);
      return {
        id: p.id,
        roomId: p.roomId,
        title: p.title,
        caption: p.caption,
        takenAt: p.takenAt,
        previewUri: p.localThumbUri ?? p.localUri,
        load: uri ? () => readLocal(uri) : null,
      };
    }),
  };
}

export interface RemoteJobSummary {
  id: string;
  title: string;
  subtitle: string;
  createdAt: string;
}

interface RemoteJobRow {
  id: string;
  property_address1: string | null;
  property_city: string | null;
  property_state: string | null;
  claim_no: string | null;
  created_at: string;
}

const remoteTitle = (row: RemoteJobRow): string =>
  row.property_address1?.trim() || (row.claim_no ? `Claim ${row.claim_no}` : 'Untitled job');

/** The signed-in company's jobs, newest first. RLS keeps it to their own. */
export async function listRemoteJobs(): Promise<RemoteJobSummary[]> {
  const { data, error } = await getSupabase()
    .from('jobs')
    .select('id, property_address1, property_city, property_state, claim_no, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as RemoteJobRow[]).map((row) => ({
    id: row.id,
    title: remoteTitle(row),
    subtitle: [row.property_city, row.property_state, row.claim_no ? `Claim ${row.claim_no}` : null]
      .filter(Boolean)
      .join(' · '),
    createdAt: row.created_at,
  }));
}

interface RemotePhotoRow {
  id: string;
  room_id: string | null;
  title: string | null;
  caption: string | null;
  taken_at: string | null;
  storage_path: string | null;
  thumb_path: string | null;
}

async function download(path: string): Promise<Uint8Array> {
  const { data, error } = await getSupabase().storage.from(PHOTO_BUCKET).download(path);
  if (error || !data) throw error ?? new Error(`could not download ${path}`);
  return new Uint8Array(await data.arrayBuffer());
}

/** From Supabase: the full-size original where it has uploaded, else the copy. */
export async function loadRemoteJob(jobId: string): Promise<ExportJob | null> {
  const supabase = getSupabase();
  const [jobResult, roomsResult, photosResult] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, property_address1, property_city, property_state, claim_no, created_at')
      .eq('id', jobId)
      .maybeSingle(),
    supabase.from('rooms').select('id, name, sort_order').eq('job_id', jobId).is('deleted_at', null),
    supabase
      .from('photos')
      .select('id, room_id, title, caption, taken_at, storage_path, thumb_path')
      .eq('job_id', jobId)
      .is('deleted_at', null),
  ]);
  if (jobResult.error) throw jobResult.error;
  if (roomsResult.error) throw roomsResult.error;
  if (photosResult.error) throw photosResult.error;
  if (!jobResult.data) return null;

  const rooms = (roomsResult.data as { id: string; name: string; sort_order: number }[]).map((r) => ({
    id: r.id,
    name: r.name,
    sortOrder: r.sort_order,
  }));

  return {
    id: jobId,
    title: remoteTitle(jobResult.data as RemoteJobRow),
    rooms,
    photos: (photosResult.data as RemotePhotoRow[]).map((p) => {
      const path = p.storage_path ?? p.thumb_path;
      return {
        id: p.id,
        roomId: p.room_id,
        title: p.title,
        caption: p.caption,
        takenAt: p.taken_at ? Date.parse(p.taken_at) : null,
        previewUri: null,
        load: path ? () => download(path) : null,
      };
    }),
  };
}
