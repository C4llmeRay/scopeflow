/**
 * Handing the ZIP over on a phone: written to the cache, then the share sheet —
 * AirDrop, email, Drive, whatever reaches the computer with Xactimate on it.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function deliverZip(zip: Uint8Array, fileName: string): Promise<boolean> {
  const target = new File(Paths.cache, fileName);
  if (target.exists) target.delete();
  target.create();
  target.write(zip);

  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(target.uri, {
    mimeType: 'application/zip',
    UTI: 'public.zip-archive',
    dialogTitle: 'Send photos for Xactimate',
  });
  return true;
}

/** Copying is a desktop affair; on the phone the list travels inside the ZIP. */
export const canCopy = false;

export async function copyText(_text: string): Promise<boolean> {
  return false;
}
