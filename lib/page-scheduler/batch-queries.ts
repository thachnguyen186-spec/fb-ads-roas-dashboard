/**
 * Batch-level reads/mutations for the Queue tab: detail (paged posts + status counts), guarded
 * delete, bulk cancel of unpushed rows. Ownership is enforced by the caller via loadOwnedBatch.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { assertOwner, type PsContext } from './access';
import { signMediaUrls } from './media-storage';
import type { PsBatch, PsPost } from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 1000;
const MAX_PAGES = 30;
export const POSTS_PAGE_SIZE = 200;
const LIVE_STATUSES = ['scheduled', 'published', 'pushing'];

/** Columns safe for the client (no ciphertext exists on ps_posts, but keep the list explicit). */
const POST_COLUMNS =
  'id, batch_id, user_id, row_number, page_id, page_name, scheduled_at, message, image_kind, image_ref, countries, status, attempts, fb_post_id, permalink_url, error, error_code, pushed_at, published_at';

export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

/** Batch visible to the caller (404 otherwise); `mustOwn` additionally enforces owner-only (403). */
export async function loadBatch(ctx: PsContext, batchId: string, mustOwn: boolean): Promise<PsBatch | Response> {
  if (!isUuid(batchId)) return errorResponse('Invalid batch id', 400);
  const { data, error } = await createServiceClient().from('ps_batches').select('*').eq('id', batchId).maybeSingle();
  if (error) return errorResponse(error.message, 500);
  const batch = data as PsBatch | null;
  if (!batch || !ctx.visibleUserIds.includes(batch.user_id)) return errorResponse('Batch not found', 404);
  if (mustOwn) return assertOwner(ctx, batch) ?? batch;
  return batch;
}

export interface BatchDetail {
  posts: (Omit<PsPost, 'image_ref'> & { image_ref: string | null; thumb_url: string | null })[];
  total: number;
  counts: Record<string, number>;
  pages: { page_id: string; page_name: string }[];
}

export async function getBatchDetail(batch: PsBatch, status: string | null, pageId: string | null, offset: number): Promise<BatchDetail> {
  const service = createServiceClient();

  const counts: Record<string, number> = {};
  const pageNames = new Map<string, string>();
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await service.from('ps_posts').select('status, page_id, page_name')
      .eq('batch_id', batch.id).order('id').range(p * PAGE, p * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { status: string; page_id: string; page_name: string }[]) {
      counts[r.status] = (counts[r.status] ?? 0) + 1;
      pageNames.set(r.page_id, r.page_name);
    }
    if ((data?.length ?? 0) < PAGE) break;
  }

  let q = service.from('ps_posts').select(POST_COLUMNS, { count: 'exact' }).eq('batch_id', batch.id);
  if (status) q = q.eq('status', status);
  if (pageId) q = q.eq('page_id', pageId);
  const { data, count, error } = await q.order('scheduled_at').order('row_number').range(offset, offset + POSTS_PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as PsPost[];

  const uploadPaths = [...new Set(rows.filter((r) => r.image_kind === 'upload' && r.image_ref).map((r) => r.image_ref as string))];
  let signed: Record<string, string> = {};
  try {
    signed = await signMediaUrls(uploadPaths);
  } catch {
    // thumbnails are cosmetic; a Storage hiccup must not break the queue view
  }
  const posts = rows.map((r) => ({
    ...r,
    thumb_url: r.image_kind === 'url' ? r.image_ref : r.image_ref ? signed[r.image_ref] ?? null : null,
  }));
  return { posts, total: count ?? 0, counts, pages: [...pageNames].map(([page_id, page_name]) => ({ page_id, page_name })) };
}

/**
 * Deletes the batch (posts cascade) unless any row is scheduled/published/pushing. Unpushed rows
 * are first cancelled with a status-guarded update so a concurrent push claim cannot race the delete
 * (a claimed row flips to 'pushing' and is then caught by the live-row recount -> 409).
 */
export async function deleteBatch(batch: PsBatch): Promise<Response> {
  const service = createServiceClient();
  const cancel = await service.from('ps_posts')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('batch_id', batch.id).eq('user_id', batch.user_id).in('status', ['draft', 'queued', 'waiting']);
  if (cancel.error) return errorResponse(cancel.error.message, 500);
  const { count, error } = await service.from('ps_posts').select('id', { count: 'exact', head: true })
    .eq('batch_id', batch.id).in('status', LIVE_STATUSES);
  if (error) return errorResponse(error.message, 500);
  if ((count ?? 0) > 0) {
    return errorResponse(`Batch has ${count} scheduled/published/pushing post(s) — cancel them first (published posts can never be deleted here)`, 409);
  }
  const del = await service.from('ps_batches').delete().eq('id', batch.id).eq('user_id', batch.user_id);
  if (del.error) return errorResponse(del.error.message, 500);
  return Response.json({ deleted: true });
}

/** Cancels every draft/queued/waiting row of the batch (local only). */
export async function cancelUnpushed(batch: PsBatch): Promise<Response> {
  const { data, error } = await createServiceClient().from('ps_posts')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('batch_id', batch.id).eq('user_id', batch.user_id).in('status', ['draft', 'queued', 'waiting']).select('id');
  if (error) return errorResponse(error.message, 500);
  return Response.json({ cancelled: data?.length ?? 0 });
}
