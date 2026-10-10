/**
 * Push engine. `pushClaimedRows` is the shared core (client step + Phase 05 cron): it takes rows
 * ALREADY claimed by ps_claim_posts (status 'pushing'), has no request/session dependency, and
 * never throws for per-row problems. `pushStep` is the owner-driven client step (<=10 rows).
 *
 * Invariants: a row left in 'pushing' is NEVER auto-retried (FB may have created it; cron
 * reconciles). Page tokens are decrypted per row and never returned or logged.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { MAX_SCHEDULE_DAYS, PUSH_MIN_LEAD_MIN } from './constants';
import { getPageToken, markProfileInvalid } from './fb-profiles';
import { decideFailure } from './push-outcome';
import { pushPost } from './push-post';
import type { PsPost } from './types';

export const PUSH_BATCH_SIZE = 10;
export const PUSH_CONCURRENCY = 5;

export type RequeueStatus = 'queued' | 'waiting';

export interface PushSummary {
  pushed: number;
  failed: number;
  requeued: number;
  /** Max backoff the caller should wait before claiming again (transient errors). */
  backoff_ms?: number;
  /** Set on code 368 (spam block): caller must stop pushing. */
  halt?: string;
  /** Rows whose DB write was lost (left 'pushing', never retried). */
  stuck: { id: string; fb_post_id: string | null }[];
}

const MAX_ERR = 500;
const nowIso = () => new Date().toISOString();

async function persist(id: string, patch: Record<string, unknown>): Promise<boolean> {
  const service = createServiceClient();
  for (let i = 0; i < 2; i++) {
    const { error } = await service.from('ps_posts').update({ ...patch, updated_at: nowIso() }).eq('id', id).eq('status', 'pushing');
    if (!error) return true;
  }
  return false;
}

async function profileMap(rows: PsPost[]): Promise<Map<string, string>> {
  const pageIds = [...new Set(rows.map((r) => r.page_id))];
  const { data } = await createServiceClient().from('ps_pages').select('user_id, page_id, profile_id').in('page_id', pageIds);
  const map = new Map<string, string>();
  for (const p of (data ?? []) as { user_id: string; page_id: string; profile_id: string }[]) map.set(`${p.user_id}|${p.page_id}`, p.profile_id);
  return map;
}

export async function pushClaimedRows(rows: PsPost[], opts: { requeueStatus: RequeueStatus }): Promise<PushSummary> {
  const summary: PushSummary = { pushed: 0, failed: 0, requeued: 0, stuck: [] };
  if (rows.length === 0) return summary;
  const profiles = await profileMap(rows);
  const invalidProfiles = new Set<string>();
  let halted = false;

  const fail = async (row: PsPost, message: string, code: number | null, photoId?: string | null) => {
    const ok = await persist(row.id, {
      status: 'failed', error: message.slice(0, MAX_ERR), error_code: code, next_attempt_at: null,
      ...(photoId ? { fb_photo_id: photoId } : {}),
    });
    if (ok) summary.failed++; else summary.stuck.push({ id: row.id, fb_post_id: null });
  };

  async function processRow(row: PsPost): Promise<void> {
    if (halted) { // release unstarted rows so the claim does not count as an attempt
      await persist(row.id, { status: opts.requeueStatus, attempts: Math.max(0, row.attempts - 1) });
      return;
    }
    const profileId = profiles.get(`${row.user_id}|${row.page_id}`);
    if (profileId && invalidProfiles.has(profileId)) {
      await fail(row, 'Profile token is invalid — re-paste it in Settings, then retry', 190);
      return;
    }
    let token: string;
    try {
      token = await getPageToken(row.user_id, row.page_id);
    } catch (err) {
      await fail(row, err instanceof Error ? err.message : 'Page token unavailable', null);
      return;
    }
    try {
      const { fbPostId, fbPhotoId } = await pushPost(row, token);
      if (!fbPostId) { // photo created but no post id: never store the photo id as the post id
        await fail(row, 'Uncertain push outcome - photo created without post id - check Business Suite before retry', null, fbPhotoId);
        return;
      }
      const ok = await persist(row.id, {
        status: 'scheduled', fb_post_id: fbPostId, fb_photo_id: fbPhotoId, pushed_at: nowIso(), error: null, error_code: null, next_attempt_at: null,
      });
      if (ok) summary.pushed++;
      else {
        console.error(`[page-scheduler] DB write lost for post ${row.id} (fb ${fbPostId}); left 'pushing'`);
        summary.stuck.push({ id: row.id, fb_post_id: fbPostId });
      }
    } catch (err) {
      const d = decideFailure(err, row.attempts);
      // Network drop / non-JSON body / FB 'unknown' (1, 2, bare 5xx) after the request left: FB may have
      // created the post, so label it "uncertain" (retry then requires confirmation, see post-actions.ts).
      const ambiguous = err instanceof TypeError || err instanceof SyntaxError || (d.action === 'fail' && d.uncertain);
      const raw = err instanceof Error ? err.message : 'Push failed';
      const message = ambiguous ? `Uncertain push outcome (${raw}) - check Business Suite before retry` : raw;
      const code = (err as { code?: unknown } | null)?.code;
      const fbCode = typeof code === 'number' ? code : null;
      if (d.action === 'requeue') {
        const ok = await persist(row.id, {
          status: opts.requeueStatus, error: `Retrying: ${message}`.slice(0, MAX_ERR), error_code: fbCode,
          next_attempt_at: new Date(Date.now() + d.backoffMs).toISOString(),
        });
        if (ok) { summary.requeued++; summary.backoff_ms = Math.max(summary.backoff_ms ?? 0, d.backoffMs); }
        else summary.stuck.push({ id: row.id, fb_post_id: null });
        return;
      }
      if (d.invalidateProfile && profileId) {
        invalidProfiles.add(profileId);
        await markProfileInvalid(profileId, message).catch(() => {});
      }
      if (d.halt) { halted = true; summary.halt = message; }
      await fail(row, message, fbCode);
    }
  }

  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const row = rows[next++];
      try {
        await processRow(row);
      } catch (err) {
        console.error(`[page-scheduler] unexpected error for post ${row.id}:`, err instanceof Error ? err.message : err);
        summary.stuck.push({ id: row.id, fb_post_id: null });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PUSH_CONCURRENCY, rows.length) }, worker));
  return summary;
}

export interface PushStepResult extends PushSummary {
  waiting: number;
  remaining_queued: number;
  done: boolean;
}

async function count(batchId: string, userId: string, status: string): Promise<number> {
  const { count: n, error } = await createServiceClient()
    .from('ps_posts').select('id', { count: 'exact', head: true }).eq('batch_id', batchId).eq('user_id', userId).eq('status', status);
  if (error) throw new Error(error.message);
  return n ?? 0;
}

/** One bounded client step for an owner's batch. Caller must have verified ownership. */
export async function pushStep(userId: string, batchId: string): Promise<PushStepResult> {
  const service = createServiceClient();
  const now = Date.now();
  const earliest = new Date(now + PUSH_MIN_LEAD_MIN * 60_000).toISOString();
  const latest = new Date(now + MAX_SCHEDULE_DAYS * 86_400_000).toISOString();

  const expire = await service.from('ps_posts')
    .update({ status: 'failed', error: 'Schedule time passed - edit time and retry', error_code: null, updated_at: nowIso() })
    .eq('batch_id', batchId).eq('user_id', userId).eq('status', 'queued').lt('scheduled_at', earliest);
  if (expire.error) throw new Error(expire.error.message);
  const park = await service.from('ps_posts')
    .update({ status: 'waiting', updated_at: nowIso() })
    .eq('batch_id', batchId).eq('user_id', userId).eq('status', 'queued').gt('scheduled_at', latest);
  if (park.error) throw new Error(park.error.message);

  const { data, error } = await service.rpc('ps_claim_posts', {
    p_status: 'queued', p_batch_id: batchId, p_user_id: userId, p_limit: PUSH_BATCH_SIZE, p_earliest: earliest, p_latest: latest,
  });
  if (error) throw new Error(error.message);

  const summary = await pushClaimedRows((data ?? []) as PsPost[], { requeueStatus: 'queued' });
  const [remaining, waiting] = await Promise.all([count(batchId, userId, 'queued'), count(batchId, userId, 'waiting')]);
  return { ...summary, waiting, remaining_queued: remaining, done: remaining === 0 };
}
