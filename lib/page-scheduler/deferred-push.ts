/**
 * Cron step 1: push 'waiting' rows that entered Facebook's scheduling window.
 * Rows too close to their time are failed (editable + retryable by the owner). Claimed rows are
 * grouped per Page so a spam block (368) / dead token on one Page only halts that Page.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { CRON_PUSH_LIMIT, MAX_SCHEDULE_DAYS, PUSH_MIN_LEAD_MIN } from './constants';
import { groupByPage } from './cron-page-access';
import { pushClaimedRows, type PushSummary, type RequeueStatus } from './push-step';
import type { PsPost } from './types';

export interface DeferredPushResult {
  expired: number;
  claimed: number;
  pushed: number;
  failed: number;
  requeued: number;
  stuck: number;
  halted_pages: number;
}

const GROUP_CONCURRENCY = 5;

/** Pushes already-claimed rows, one group per Page (a 368 / dead token only halts its own Page). */
export async function pushRowsByPage(
  rows: PsPost[], requeueStatus: RequeueStatus,
  out: Pick<DeferredPushResult, 'pushed' | 'failed' | 'requeued' | 'stuck' | 'halted_pages'>,
): Promise<void> {
  const groups = [...groupByPage(rows).values()];
  let next = 0;
  const worker = async () => {
    while (next < groups.length) {
      const group = groups[next++];
      let s: PushSummary;
      try {
        s = await pushClaimedRows(group, { requeueStatus });
      } catch (err) {
        console.error('[page-scheduler] deferred push group error:', err instanceof Error ? err.message : err);
        out.stuck += group.length;
        continue;
      }
      out.pushed += s.pushed; out.failed += s.failed; out.requeued += s.requeued; out.stuck += s.stuck.length;
      if (s.halt) out.halted_pages++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(GROUP_CONCURRENCY, groups.length) }, worker));
}

export async function pushDueWaiting(deadline: number, reserveMs = 20_000): Promise<DeferredPushResult> {
  const service = createServiceClient();
  const now = Date.now();
  const earliest = new Date(now + PUSH_MIN_LEAD_MIN * 60_000).toISOString();
  const latest = new Date(now + MAX_SCHEDULE_DAYS * 86_400_000).toISOString();
  const out: DeferredPushResult = { expired: 0, claimed: 0, pushed: 0, failed: 0, requeued: 0, stuck: 0, halted_pages: 0 };

  const exp = await service.from('ps_posts')
    .update({ status: 'failed', error: 'Missed push window (cron outage) - edit time and retry', error_code: null, updated_at: new Date().toISOString() })
    .eq('status', 'waiting').lt('scheduled_at', earliest).select('id');
  if (exp.error) throw new Error(exp.error.message);
  out.expired = exp.data?.length ?? 0;

  if (Date.now() > deadline - reserveMs) return out;
  const { data, error } = await service.rpc('ps_claim_posts', {
    p_status: 'waiting', p_batch_id: null, p_user_id: null, p_limit: CRON_PUSH_LIMIT, p_earliest: earliest, p_latest: latest,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as PsPost[];
  out.claimed = rows.length;

  await pushRowsByPage(rows, 'waiting', out);
  return out;
}
