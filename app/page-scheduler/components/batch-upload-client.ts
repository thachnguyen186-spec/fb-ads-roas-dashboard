/** Browser-side steps of the batch flow: create -> direct Storage upload -> finalize. */

import { createClient } from '@/lib/supabase/client';
import { MEDIA_BUCKET } from '@/lib/page-scheduler/constants';
import type { RawRow } from '@/lib/page-scheduler/file-parse';
import { contentTypeFor, sanitizeFileName } from '@/lib/page-scheduler/upload-file-rules';
import type { PsRowIssue, PsSourceType } from '@/lib/page-scheduler/types';

export interface UploadTarget { name: string; path: string; token: string }

export interface CreatedBatch {
  batch_id: string;
  batch_status: 'awaiting_media' | 'ready';
  row_count: number;
  uploads: UploadTarget[];
}

/** Thrown with server-side row issues so the UI can show them next to the preview. */
export class BatchRequestError extends Error {
  constructor(message: string, public issues: PsRowIssue[] = [], public missing: string[] = []) {
    super(message);
  }
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 4;

export async function createBatchRequest(args: {
  fileName: string; sourceType: PsSourceType; rows: RawRow[]; files: File[]; extraColumns: string[];
}): Promise<CreatedBatch> {
  const body = JSON.stringify({
    file_name: args.fileName,
    source_type: args.sourceType,
    rows: args.rows,
    files: args.files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
    extra_columns: args.extraColumns,
  });
  if (body.length > MAX_BODY_BYTES) throw new BatchRequestError('File is too large for one upload (over 4 MB of text) — split it into smaller files.');
  const res = await fetch('/api/page-scheduler/batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new BatchRequestError(data.error ?? 'Failed to create batch', data.issues ?? []);
  return data as CreatedBatch;
}

/** Uploads straight to Storage via signed tokens (4 at a time). Returns names that failed. */
export async function uploadImages(
  targets: UploadTarget[], files: File[], onProgress: (done: number, total: number) => void,
): Promise<string[]> {
  const bySafe = new Map(files.map((f) => [sanitizeFileName(f.name), f]));
  const bucket = createClient().storage.from(MEDIA_BUCKET);
  const failed: string[] = [];
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < targets.length) {
      const t = targets[next++];
      const file = bySafe.get(t.name);
      if (!file) { failed.push(t.name); continue; }
      const { error } = await bucket.uploadToSignedUrl(t.path, t.token, file, { contentType: file.type || contentTypeFor(t.name) });
      // "already exists" = a previous attempt succeeded; treat as done.
      if (error && !/already exists|duplicate/i.test(error.message)) failed.push(t.name);
      onProgress(++done, targets.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, targets.length) }, worker));
  return failed;
}

export async function finalizeRequest(batchId: string): Promise<{ queued: number; waiting: number }> {
  const res = await fetch(`/api/page-scheduler/batches/${batchId}/finalize`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const missing: string[] = [...(data.missing ?? []), ...(data.invalid ?? [])];
    throw new BatchRequestError(data.error ?? 'Finalize failed', [], missing);
  }
  return data;
}
