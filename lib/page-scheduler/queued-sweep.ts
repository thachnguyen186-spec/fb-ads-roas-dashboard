/**
 * Cron step 1b: rescue 'queued' rows whose owner closed the browser mid-push (the client loop is
 * the normal driver). Only rows idle >= QUEUED_IDLE_MIN are touched, so the cron never competes
 * with an active browser loop; ps_claim_posts' SKIP LOCKED covers any residual overlap.
 * Rows already past the push lead time are failed (editable + retryable by the owner).
 */

import { createServiceClient } from '@/lib/supabase/server';
import { CRON_QUEUED_LIMIT, MAX_SCHEDULE_DAYS, PUSH_MIN_LEAD_MIN, QUEUED_IDLE_MIN } from './constants';
import { pushRowsByPage, type DeferredPushResult } from './deferred-push';
import type { PsPost } from './types';

export async function pushIdleQueued(deadline: number, reserveMs = 20_000): Promise<DeferredPushResult> {
  const service = createServiceClient();
  const now = Date.now();
  const earliest = new Date(now + PUSH_MIN_LEAD_MIN * 60_000).toISOString();
  const latest = new Date(now + MAX_SCHEDULE_DAYS * 86_400_000).toISOString();
  const idleCutoff = new Date(now - QUEUED_IDLE_MIN * 60_000).toISOString();
  const out: DeferredPushResult = { expired: 0, claimed: 0, pushed: 0, failed: 0, requeued: 0, stuck: 0, halted_pages: 0 };

  const exp = await service.from('ps_posts')
    .update({ status: 'failed', error: 'Schedule time passed - edit time and retry', error_code: null, next_attempt_at: null, updated_at: new Date().toISOString() })
    .eq('status', 'queued').lt('scheduled_at', earliest).lt('updated_at', idleCutoff).select('id');
  if (exp.error) throw new Error(exp.error.message);
  out.expired = exp.data?.length ?? 0;

  if (Date.now() > deadline - reserveMs) return out;
  const { data, error } = await service.rpc('ps_claim_posts', {
    p_status: 'queued', p_batch_id: null, p_user_id: null, p_limit: CRON_QUEUED_LIMIT,
    p_earliest: earliest, p_latest: latest, p_idle_minutes: QUEUED_IDLE_MIN,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as PsPost[];
  out.claimed = rows.length;
  await pushRowsByPage(rows, 'queued', out);
  return out;
}
