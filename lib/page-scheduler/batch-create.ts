/**
 * Authoritative batch creation. Re-runs the shared validator with DB context (own active pages,
 * default countries, existing Page+time slots). All-or-nothing: any error -> nothing is stored.
 * Rows with uploaded images start as `draft` (batch `awaiting_media`) until finalize verifies
 * the files; image-less batches go straight to `queued`/`waiting` (batch `ready`).
 */

import { createServiceClient } from '@/lib/supabase/server';
import { DEFAULT_COUNTRIES, MAX_ROWS_PER_UPLOAD, MAX_SCHEDULE_DAYS } from './constants';
import type { RawRow } from './file-parse';
import { createUploadTargets, ensureMediaBucket, mediaPath, type UploadTarget } from './media-storage';
import { validateRows, type ValidatedRow } from './row-validation';
import type { UploadFileInfo } from './upload-file-rules';
import type { PsPostStatus, PsRowIssue, PsSourceType } from './types';

export interface BatchPayload {
  file_name: string;
  source_type: PsSourceType;
  rows: RawRow[];
  files: UploadFileInfo[];
  extra_columns: string[];
}

export type CreateBatchResult =
  | { ok: false; status: number; error: string; issues: PsRowIssue[] }
  | { ok: true; batch_id: string; batch_status: 'awaiting_media' | 'ready'; row_count: number; uploads: UploadTarget[]; issues: PsRowIssue[] };

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const INSERT_CHUNK = 200;

/** Shape-checks untrusted JSON into a BatchPayload; returns an error string otherwise. */
export function parseBatchPayload(body: unknown): BatchPayload | string {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return 'Invalid request body';
  if (!Array.isArray(b.rows) || b.rows.length === 0) return 'rows must be a non-empty array';
  if (b.rows.length > MAX_ROWS_PER_UPLOAD) return `Max ${MAX_ROWS_PER_UPLOAD} rows per upload`;
  const files = Array.isArray(b.files) ? b.files : [];
  if (files.length > 500) return 'Too many image files (max 500)';
  return {
    file_name: str(b.file_name, 255),
    source_type: b.source_type === 'json' ? 'json' : 'csv',
    // Row numbers are re-assigned from position so the client can't forge them.
    rows: b.rows.map((r: Record<string, unknown>, i: number) => ({
      row: i + 1,
      scheduled_at: str(r?.scheduled_at, 64),
      page_id: str(r?.page_id, 64),
      message: str(r?.message, 70_000),
      image: str(r?.image, 2048),
      countries: str(r?.countries, 256),
    })),
    files: files.map((f: Record<string, unknown>) => ({
      name: str(f?.name, 255),
      size: Number(f?.size) || 0,
      type: str(f?.type, 100),
    })),
    extra_columns: Array.isArray(b.extra_columns) ? b.extra_columns.slice(0, 20).map((c) => str(c, 64)) : [],
  };
}

async function loadContext(userId: string) {
  const service = createServiceClient();
  const [pagesRes, settingsRes] = await Promise.all([
    service.from('ps_pages').select('page_id, name, tasks').eq('user_id', userId).eq('is_active', true),
    service.from('ps_settings').select('default_countries').eq('user_id', userId).maybeSingle(),
  ]);
  if (pagesRes.error) throw new Error(pagesRes.error.message);
  const pages = (pagesRes.data ?? []) as { page_id: string; name: string; tasks: string[] }[];
  const defaults = (settingsRes.data as { default_countries: string[] } | null)?.default_countries;
  return { pages, defaultCountries: defaults?.length ? defaults : [...DEFAULT_COUNTRIES] };
}

/** Rows whose Page + time slot is already used by a live post of this user. */
async function findTakenSlots(userId: string, rows: ValidatedRow[]): Promise<Set<string>> {
  const times = rows.map((r) => r.ms as number);
  const service = createServiceClient();
  const { data, error } = await service
    .from('ps_posts')
    .select('page_id, scheduled_at')
    .eq('user_id', userId)
    .in('page_id', [...new Set(rows.map((r) => r.page_id))])
    .gte('scheduled_at', new Date(Math.min(...times)).toISOString())
    .lte('scheduled_at', new Date(Math.max(...times)).toISOString())
    .not('status', 'in', '(cancelled,failed)')
    .limit(5000);
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as { page_id: string; scheduled_at: string }[]).map((p) => `${p.page_id}|${Date.parse(p.scheduled_at)}`));
}

export async function createBatch(userId: string, payload: BatchPayload): Promise<CreateBatchResult> {
  const ctx = await loadContext(userId);
  const result = validateRows(payload.rows, {
    ...ctx, files: payload.files, nowMs: Date.now(), extraColumns: payload.extra_columns,
  });
  const issues = [...result.issues];

  if (result.errorCount === 0) {
    const taken = await findTakenSlots(userId, result.rows);
    for (const r of result.rows) {
      if (taken.has(`${r.page_id}|${r.ms}`)) {
        issues.push({ row: r.row, field: 'scheduled_at', level: 'error', message: 'This Page already has a post at that time (previous upload or batch)' });
      }
    }
  }
  if (issues.some((i) => i.level === 'error')) {
    return { ok: false, status: 400, error: 'Validation failed — fix the listed rows and upload again', issues };
  }

  const uploadNames = [...new Set(result.rows.filter((r) => r.image_kind === 'upload').map((r) => r.image_ref as string))];
  if (uploadNames.length) await ensureMediaBucket();

  const service = createServiceClient();
  const needsMedia = uploadNames.length > 0;
  const batchStatus = needsMedia ? 'awaiting_media' : 'ready';
  const { data: batch, error: batchErr } = await service
    .from('ps_batches')
    .insert({ user_id: userId, file_name: payload.file_name, source_type: payload.source_type, status: batchStatus, row_count: result.rows.length })
    .select('id')
    .single();
  if (batchErr || !batch) throw new Error(batchErr?.message ?? 'Failed to create batch');
  const batchId = (batch as { id: string }).id;

  const cutoff = Date.now() + MAX_SCHEDULE_DAYS * 86_400_000;
  const records = result.rows.map((r) => {
    const status: PsPostStatus = needsMedia ? 'draft' : (r.ms as number) > cutoff ? 'waiting' : 'queued';
    return {
      batch_id: batchId, user_id: userId, row_number: r.row, page_id: r.page_id, page_name: r.page_name,
      scheduled_at: r.scheduled_at, message: r.message, image_kind: r.image_kind,
      image_ref: r.image_kind === 'upload' ? mediaPath(userId, batchId, r.image_ref as string) : r.image_ref,
      countries: r.countries, status,
    };
  });

  try {
    for (let i = 0; i < records.length; i += INSERT_CHUNK) {
      const { error } = await service.from('ps_posts').insert(records.slice(i, i + INSERT_CHUNK));
      if (error) throw Object.assign(new Error(error.message), { code: (error as { code?: string }).code });
    }
    const uploads = await createUploadTargets(userId, batchId, uploadNames);
    return { ok: true, batch_id: batchId, batch_status: batchStatus, row_count: records.length, uploads, issues };
  } catch (err) {
    await service.from('ps_batches').delete().eq('id', batchId); // cascades posts
    if ((err as { code?: string }).code === '23505') {
      return { ok: false, status: 409, error: 'A Page + time slot in this file was just taken by another upload — retry', issues };
    }
    throw err;
  }
}
