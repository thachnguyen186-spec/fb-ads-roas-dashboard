/**
 * Supabase Storage access for Page Scheduler images (private bucket `page-scheduler-media`).
 * Server only. Browser uploads go straight to Storage via signed upload URLs created here, so
 * image bytes never pass through a route handler (Vercel 4.5 MB body cap).
 * Paths are generated server-side: ps/{userId}/{batchId}/{safeName}.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { MEDIA_BUCKET } from './constants';
import { PsUserError } from './fb-profiles';
import { contentTypeFor } from './upload-file-rules';

const SIGN_TTL_SECONDS = 3600;
const LIST_PAGE = 1000;
const SIGN_CONCURRENCY = 8;

export interface UploadTarget {
  name: string;
  path: string;
  token: string;
}

export interface StoredObject {
  name: string;
  size: number;
}

export const mediaPath = (userId: string, batchId: string, safeName: string) => `ps/${userId}/${batchId}/${safeName}`;

function bucketError(message: string): PsUserError {
  return /bucket not found|not found/i.test(message)
    ? new PsUserError(`Storage bucket "${MEDIA_BUCKET}" does not exist — create it as a private bucket in Supabase Storage.`)
    : new PsUserError(`Storage error: ${message}`);
}

/** Throws a clear PsUserError when the bucket has not been created yet. */
export async function ensureMediaBucket(): Promise<void> {
  const { error } = await createServiceClient().storage.getBucket(MEDIA_BUCKET);
  if (error) throw bucketError(error.message);
}

/** One signed upload URL token per file (valid ~2h, no overwrite). */
export async function createUploadTargets(userId: string, batchId: string, safeNames: string[]): Promise<UploadTarget[]> {
  const bucket = createServiceClient().storage.from(MEDIA_BUCKET);
  const out: UploadTarget[] = new Array(safeNames.length);
  for (let i = 0; i < safeNames.length; i += SIGN_CONCURRENCY) {
    await Promise.all(safeNames.slice(i, i + SIGN_CONCURRENCY).map(async (name, k) => {
      const path = mediaPath(userId, batchId, name);
      const { data, error } = await bucket.createSignedUploadUrl(path);
      if (error || !data?.token) throw bucketError(error?.message ?? 'could not create upload URL');
      out[i + k] = { name, path, token: data.token };
    }));
  }
  return out;
}

/** Lists objects already uploaded for a batch (name = safe file name, size from metadata). */
export async function listBatchObjects(userId: string, batchId: string): Promise<StoredObject[]> {
  const bucket = createServiceClient().storage.from(MEDIA_BUCKET);
  const { data, error } = await bucket.list(`ps/${userId}/${batchId}`, { limit: LIST_PAGE });
  if (error) throw bucketError(error.message);
  return (data ?? [])
    .filter((o) => o.id) // folders have no id
    .map((o) => ({ name: o.name, size: Number((o.metadata as { size?: number } | null)?.size ?? 0) }));
}

/** Downloads an uploaded image for the multipart `source` push (Phase 04). */
export async function downloadMedia(path: string): Promise<{ bytes: Uint8Array; contentType: string; fileName: string }> {
  const { data, error } = await createServiceClient().storage.from(MEDIA_BUCKET).download(path);
  if (error || !data) throw new PsUserError(`Uploaded image missing in storage (${path}): ${error?.message ?? 'not found'}`);
  const fileName = path.split('/').pop() ?? 'image';
  return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || contentTypeFor(fileName), fileName };
}

/** Short-lived signed read URL (UI thumbnails). */
export async function signMediaUrl(path: string, ttlSeconds = SIGN_TTL_SECONDS): Promise<string> {
  const { data, error } = await createServiceClient().storage.from(MEDIA_BUCKET).createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) throw new PsUserError(`Failed to sign Storage URL: ${error?.message ?? 'unknown error'}`);
  return data.signedUrl;
}

/** Batch variant of signMediaUrl: path -> signed URL (missing/failed paths are omitted). */
export async function signMediaUrls(paths: string[], ttlSeconds = SIGN_TTL_SECONDS): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await createServiceClient().storage.from(MEDIA_BUCKET).createSignedUrls(paths, ttlSeconds);
  if (error) throw new PsUserError(`Failed to sign Storage URLs: ${error.message}`);
  const out: Record<string, string> = {};
  for (const item of data ?? []) if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
  return out;
}
