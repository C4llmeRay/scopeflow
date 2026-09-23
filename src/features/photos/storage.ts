/**
 * Where a captured photo lives on the phone.
 *
 * The camera and the image manipulator both write to the cache directory, which
 * the OS is free to empty whenever it is short of space. A photo is evidence and
 * may sit on the phone for days waiting for Wi-Fi, so both files are moved into
 * the app's documents directory before the row is written.
 */

import { Directory, File, Paths } from 'expo-file-system';

export interface StoredPhoto {
  originalUri: string;
  thumbUri: string;
}

export async function persistPhoto(
  jobId: string,
  photoId: string,
  capturedUri: string,
  derivativeUri: string,
): Promise<StoredPhoto> {
  const dir = new Directory(Paths.document, 'photos', jobId);
  dir.create({ intermediates: true, idempotent: true });

  // Moved, not copied or re-encoded: the original keeps its EXIF untouched.
  const original = new File(dir, `${photoId}.jpg`);
  const thumb = new File(dir, `${photoId}-thumb.jpg`);
  await new File(capturedUri).move(original);
  await new File(derivativeUri).move(thumb);

  return { originalUri: original.uri, thumbUri: thumb.uri };
}
