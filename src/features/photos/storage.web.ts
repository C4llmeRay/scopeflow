/**
 * In a browser the camera hands back data URIs, which already live in the row
 * itself — there is no cache directory to rescue them from.
 */

export interface StoredPhoto {
  originalUri: string;
  thumbUri: string;
}

export async function persistPhoto(
  _jobId: string,
  _photoId: string,
  capturedUri: string,
  derivativeUri: string,
): Promise<StoredPhoto> {
  return { originalUri: capturedUri, thumbUri: derivativeUri };
}
