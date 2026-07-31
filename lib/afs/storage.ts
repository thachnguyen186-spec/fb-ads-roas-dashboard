/**
 * Rehosts a Kie-generated image into the private `afs-creatives` Storage bucket. Downloaded
 * immediately and never re-referenced by Kie URL (those expire; see Phase 04 Risk Assessment).
 */
import { createServiceClient } from '@/lib/supabase/server';
import type { AfsStyleKey } from '@/lib/types';

const BUCKET = 'afs-creatives';
const FETCH_TIMEOUT_MS = 15_000;
const MIN_BYTES = 10 * 1024;
const MAX_BYTES = 8 * 1024 * 1024;
const MIN_DIMENSION = 600;
const SIGN_TTL_SECONDS = 3600;

interface Dimensions { width: number; height: number }

function readPngDimensions(bytes: Uint8Array): Dimensions | null {
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

function readJpegDimensions(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset < bytes.length - 9) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xff) { offset += 1; continue; } // padding byte
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: view.getUint16(offset + 5, false), width: view.getUint16(offset + 7, false) };
    const segmentLength = view.getUint16(offset + 2, false);
    offset += 2 + segmentLength;
  }
  return null;
}

interface RehostResult {
  storage_path: string;
  width: number;
  height: number;
}

/**
 * Defense-in-depth against SSRF: `url` comes from Kie's `recordInfo` response, an external vendor
 * we don't otherwise control — reject anything that isn't a plain https:// URL to a public host
 * before this server ever issues the `fetch`.
 */
function assertSafeImageUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Kie returned an invalid image URL');
  }
  if (parsed.protocol !== 'https:') throw new Error('Kie image URL must use https://');

  const host = parsed.hostname.toLowerCase();
  const isPrivate =
    host === 'localhost' || host === '0.0.0.0' || host === '::1' ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith('.internal') || host.endsWith('.local');
  if (isPrivate) throw new Error('Kie image URL points to a private/internal address — refusing to fetch');
}

/** Downloads, validates (type/size/dimensions), and uploads to Storage. Rejects images below 600×600. */
export async function rehostKieImage(
  userId: string,
  batchId: string,
  topicId: string,
  creativeId: string,
  styleKey: AfsStyleKey,
  url: string,
): Promise<RehostResult> {
  assertSafeImageUrl(url);

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    throw new Error(`Failed to download generated image — ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new Error(`Failed to download generated image — HTTP ${res.status}`);

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`Downloaded file is not an image (content-type: ${contentType || 'unknown'})`);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < MIN_BYTES || bytes.byteLength > MAX_BYTES) {
    throw new Error(`Downloaded image size ${bytes.byteLength} bytes is out of the allowed 10KB-8MB range`);
  }

  const dimensions = readPngDimensions(bytes) ?? readJpegDimensions(bytes);
  if (!dimensions) throw new Error('Could not determine image dimensions from the PNG/JPEG header');
  if (dimensions.width < MIN_DIMENSION || dimensions.height < MIN_DIMENSION) {
    throw new Error(
      `Generated image is too small (${dimensions.width}x${dimensions.height}, need ≥ ${MIN_DIMENSION}x${MIN_DIMENSION}) — regenerate`,
    );
  }

  const path = `afs/${userId}/${batchId}/${topicId}/${creativeId}-${styleKey}.png`;
  const service = createServiceClient();
  const { error } = await service.storage.from(BUCKET).upload(path, bytes, {
    contentType: contentType.startsWith('image/') ? contentType : 'image/png',
    upsert: true,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  return { storage_path: path, width: dimensions.width, height: dimensions.height };
}

/** Returns a 1h signed URL for a private-bucket object. */
export async function signUrl(path: string): Promise<string> {
  const service = createServiceClient();
  const { data, error } = await service.storage.from(BUCKET).createSignedUrl(path, SIGN_TTL_SECONDS);
  if (error || !data?.signedUrl) throw new Error(`Failed to sign Storage URL: ${error?.message ?? 'unknown error'}`);
  return data.signedUrl;
}
