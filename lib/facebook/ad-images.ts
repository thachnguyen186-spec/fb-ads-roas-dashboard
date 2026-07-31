/**
 * Uploads one image to an ad account's image library (`POST /act_{id}/adimages`), returning
 * the `image_hash` used by ad creatives. Multipart upload (not base64) — see fb-client.ts's
 * fbPostMultipart for rationale. Response is a map keyed by the multipart field name used for
 * the file, e.g. `{ "<field>": { hash, url, ... } }`.
 */

import { fbPostMultipart, AFS_FB_API_BASE } from './fb-client';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export async function uploadAdImage(
  token: string,
  accountId: string,
  bytes: Buffer,
  filename: string,
): Promise<string> {
  if (!bytes || bytes.length === 0) {
    throw new Error('uploadAdImage: image bytes are empty');
  }
  if (bytes.length >= MAX_IMAGE_BYTES) {
    throw new Error(`uploadAdImage: image exceeds the 8MB Facebook limit (${bytes.length} bytes)`);
  }

  // Copy into a plain Uint8Array backed by its own ArrayBuffer — Buffer's underlying buffer is
  // typed ArrayBufferLike (possibly SharedArrayBuffer-backed), which DOM's BlobPart rejects.
  const blob = new Blob([Uint8Array.from(bytes)], { type: 'image/png' });
  const json = await fbPostMultipart(
    `/${accountId}/adimages`,
    { [filename]: blob },
    {},
    token,
    AFS_FB_API_BASE,
  ) as { images?: Record<string, { hash?: string }> };

  const first = json.images ? Object.values(json.images)[0] : undefined;
  if (!first?.hash) throw new Error('adimages returned no hash');
  return first.hash;
}
