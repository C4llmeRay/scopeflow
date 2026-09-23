/**
 * Where to load a photo from.
 *
 * The file on this phone wins whenever there is one — it is instant and works
 * with no signal. A photo that arrived from the server (shot on another phone,
 * or on this one before a reinstall) has only storage paths, so it is shown
 * through a short-lived signed URL from the private bucket.
 */

import { useEffect, useState } from 'react';

import type { PhotoRecord, PhotoVariant } from '../../db/photos';
import { getSupabase, isSupabaseConfigured } from '../../lib/supabase';

export const PHOTO_BUCKET = 'job-media';

/** An hour: long enough for a review session, short enough to be worthless leaked. */
const SIGNED_URL_SECONDS = 3600;

export function localPhotoUri(photo: PhotoRecord, variant: PhotoVariant): string | null {
  return variant === 'thumb'
    ? (photo.localThumbUri ?? photo.localUri)
    : (photo.localUri ?? photo.localThumbUri);
}

function remotePath(photo: PhotoRecord, variant: PhotoVariant): string | null {
  return variant === 'thumb'
    ? (photo.thumbPath ?? photo.storagePath)
    : (photo.storagePath ?? photo.thumbPath);
}

export function usePhotoUri(photo: PhotoRecord, variant: PhotoVariant): string | null {
  const local = localPhotoUri(photo, variant);
  const path = local ? null : remotePath(photo, variant);
  const [signed, setSigned] = useState<{ path: string; url: string } | null>(null);

  useEffect(() => {
    if (!path || !isSupabaseConfigured()) return;
    let active = true;
    void getSupabase()
      .storage.from(PHOTO_BUCKET)
      .createSignedUrl(path, SIGNED_URL_SECONDS)
      .then(({ data }) => {
        if (active && data?.signedUrl) setSigned({ path, url: data.signedUrl });
      });
    return () => {
      active = false;
    };
  }, [path]);

  if (local) return local;
  return signed && signed.path === path ? signed.url : null;
}
