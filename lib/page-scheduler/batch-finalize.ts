/**
 * Finalize an `awaiting_media` batch: verify every referenced upload exists with sane size, then
 * promote `draft` posts -> `queued` (in FB window) / `waiting` (beyond window) and batch -> `ready`.
 * Idempotent: a `ready` batch returns immediately; a partial upload returns the missing list.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { MAX_SCHEDULE_DAYS } from './constants';
import { listBatchObjects } from './media-storage';
import { fileProblem } from './upload-file-rules';

export type FinalizeResult =
  | { ok: true; already: boolean; queued: number; waiting: number }
  | { ok: false; status: number; error: string; missing?: string[]; invalid?: string[] };

/** `visibleUserIds`: batches outside the caller's visibility are reported as 404 (existence hidden). */
export async function finalizeBatch(userId: string, batchId: string, visibleUserIds: string[]): Promise<FinalizeResult> {
  const service = createServiceClient();
  const { data: batch, error: bErr } = await service
    .from('ps_batches').select('id, user_id, status').eq('id', batchId).maybeSingle();
  if (bErr) throw new Error(bErr.message);
  const b = batch as { id: string; user_id: string; status: string } | null;
  if (!b || !visibleUserIds.includes(b.user_id)) return { ok: false, status: 404, error: 'Batch not found' };
  if (b.user_id !== userId) return { ok: false, status: 403, error: 'Forbidden — only the owner can modify this' };
  if (b.status === 'ready') return { ok: true, already: true, queued: 0, waiting: 0 };

  const { data: posts, error: pErr } = await service
    .from('ps_posts').select('image_ref').eq('batch_id', batchId).eq('status', 'draft').eq('image_kind', 'upload');
  if (pErr) throw new Error(pErr.message);
  const refs = [...new Set(((posts ?? []) as { image_ref: string }[]).map((p) => p.image_ref))];

  const stored = new Map((await listBatchObjects(userId, batchId)).map((o) => [o.name, o.size]));
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const ref of refs) {
    const name = ref.split('/').pop() as string;
    const size = stored.get(name);
    if (size === undefined) missing.push(name);
    else {
      const problem = fileProblem(name, size);
      if (problem) invalid.push(`${name}: ${problem}`);
    }
  }
  if (missing.length || invalid.length) {
    return { ok: false, status: 409, error: 'Some images are missing or invalid', missing, invalid };
  }

  const cutoffIso = new Date(Date.now() + MAX_SCHEDULE_DAYS * 86_400_000).toISOString();
  const { data: waiting, error: wErr } = await service
    .from('ps_posts').update({ status: 'waiting', updated_at: new Date().toISOString() })
    .eq('batch_id', batchId).eq('status', 'draft').gt('scheduled_at', cutoffIso).select('id');
  if (wErr) throw new Error(wErr.message);
  const { data: queued, error: qErr } = await service
    .from('ps_posts').update({ status: 'queued', updated_at: new Date().toISOString() })
    .eq('batch_id', batchId).eq('status', 'draft').select('id');
  if (qErr) throw new Error(qErr.message);

  const { error: uErr } = await service
    .from('ps_batches').update({ status: 'ready', updated_at: new Date().toISOString() }).eq('id', batchId);
  if (uErr) throw new Error(uErr.message);
  return { ok: true, already: false, queued: queued?.length ?? 0, waiting: waiting?.length ?? 0 };
}
