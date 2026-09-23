/**
 * Bytes out of a `data:` URI, for the few binaries that never touch the file
 * system: the sample job's photos, and anything captured in a browser.
 */

export interface DecodedDataUri {
  bytes: Uint8Array;
  contentType: string;
}

export function isDataUri(uri: string): boolean {
  return uri.startsWith('data:');
}

export function decodeDataUri(uri: string): DecodedDataUri {
  const comma = uri.indexOf(',');
  if (!isDataUri(uri) || comma < 0) throw new Error('not a data URI');

  const meta = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  const parts = meta.split(';');
  const contentType = parts[0] || 'application/octet-stream';

  if (parts.includes('base64')) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { bytes, contentType };
  }
  return { bytes: new TextEncoder().encode(decodeURIComponent(payload)), contentType };
}
