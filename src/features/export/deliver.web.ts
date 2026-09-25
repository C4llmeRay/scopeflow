/**
 * Handing the ZIP over in a browser: a download, into the folder Xactimate's
 * photo import will be pointed at.
 */

export async function deliverZip(zip: Uint8Array, fileName: string): Promise<boolean> {
  const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
  const link = window.document.createElement('a');
  link.href = url;
  link.download = fileName;
  window.document.body.append(link);
  link.click();
  link.remove();
  // Long enough for the download to have started.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

/** At the desk, with Xactimate open, copying a name or description is the point. */
export const canCopy = true;

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
