/**
 * Cron steps 2-3: confirm `scheduled` posts actually published, and resolve stale `pushing` rows
 * (FB may have created the post but our DB write was lost). Per-page failures are isolated.
 * Rows of Pages without a usable token never block the run limit; they are failed once old enough.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { fbGet, PAGE_SCHEDULER_FB_API_BASE } from '@/lib/facebook/fb-client';
import { DISCONNECTED_FAIL_HOURS, RECONCILE_GRACE_MIN, RECONCILE_MAX_POSTS_PER_RUN, STALE_PUSHING_MIN } from './constants';
import { collectUsableRows, createPageAccess, groupByPage, loadUsablePageKeys, type PageAccess } from './cron-page-access';
import { graphBatch } from './graph-batch';
import { classifyFbError } from './graph-errors';
import { decideAdoption, decideScheduled, type FbScheduledPost } from './reconcile-decision';
import type { PsPost } from './types';

export interface ReconcileResult { published: number; failed: number; adopted: number; uncertain: number; skipped_pages: number }

const nowIso = () => new Date().toISOString();
const DISCONNECTED_MSG = 'Page disconnected - cannot verify';
const SCHEDULED_LIST_MAX_PAGES = 5;

async function guarded(id: string, from: string, patch: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await createServiceClient().from('ps_posts')
    .update({ ...patch, updated_at: nowIso() }).eq('id', id).eq('status', from).select('id');
  if (error) console.error(`[page-scheduler] reconcile update failed for ${id}: ${error.message}`);
  return !error && (data?.length ?? 0) > 0;
}

/** Bulk-fails rows (still in `from`) of token-less Pages whose `ageField` is older than the cutoff. */
async function failDisconnected(rows: PsPost[], from: string, ageField: 'scheduled_at' | 'claimed_at', message: string): Promise<number> {
  const cutoff = Date.now() - DISCONNECTED_FAIL_HOURS * 3_600_000;
  const ids = rows.filter((r) => Date.parse(String(r[ageField])) < cutoff).map((r) => r.id);
  let n = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await createServiceClient().from('ps_posts')
      .update({ status: 'failed', error: message, error_code: null, updated_at: nowIso() })
      .in('id', ids.slice(i, i + 100)).eq('status', from).select('id');
    if (error) console.error(`[page-scheduler] disconnected-fail update failed: ${error.message}`);
    else n += data?.length ?? 0;
  }
  return n;
}

async function reconcileScheduled(access: PageAccess, usable: Set<string>, deadline: number, out: ReconcileResult): Promise<void> {
  const cutoff = new Date(Date.now() - RECONCILE_GRACE_MIN * 60_000).toISOString();
  const candidates = await collectUsableRows<PsPost>(usable, RECONCILE_MAX_POSTS_PER_RUN, async (from, to) => {
    const { data, error } = await createServiceClient().from('ps_posts').select('*')
      .eq('status', 'scheduled').not('fb_post_id', 'is', null).lt('scheduled_at', cutoff)
      .order('scheduled_at', { ascending: true }).order('id').range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as PsPost[];
  }, async (dead) => { out.failed += await failDisconnected(dead, 'scheduled', 'scheduled_at', `${DISCONNECTED_MSG} - check Business Suite`); });

  for (const [, rows] of groupByPage(candidates)) {
    if (Date.now() > deadline) return;
    const { user_id: userId, page_id: pageId } = rows[0];
    const token = await access.token(userId, pageId);
    if (!token) { out.skipped_pages++; continue; }
    const items = await graphBatch(token, rows.map((r) => ({
      method: 'GET' as const, relative_url: `${r.fb_post_id}?fields=is_published,permalink_url,created_time`,
    })));
    const now = Date.now();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const d = decideScheduled(items[i], Date.parse(row.scheduled_at), now);
      if (d.action === 'published') {
        if (await guarded(row.id, 'scheduled', { status: 'published', published_at: row.scheduled_at, permalink_url: d.permalink, error: null, error_code: null })) out.published++;
      } else if (d.action === 'failed') {
        if (await guarded(row.id, 'scheduled', { status: 'failed', error: d.error, error_code: null })) out.failed++;
      } else if (d.action === 'auth') {
        await access.invalidate(userId, pageId, d.error);
        out.skipped_pages++;
        break;
      }
    }
  }
}

/** Follows paging.next (bounded) so Pages with >100 scheduled posts are still matched. */
async function listScheduled(token: string, pageId: string): Promise<FbScheduledPost[]> {
  const all: FbScheduledPost[] = [];
  let after: string | undefined;
  for (let i = 0; i < SCHEDULED_LIST_MAX_PAGES; i++) {
    const params: Record<string, string> = { fields: 'id,message,scheduled_publish_time', limit: '100' };
    if (after) params.after = after;
    const res = await fbGet(`/${pageId}/scheduled_posts`, params, token, PAGE_SCHEDULER_FB_API_BASE) as {
      data?: FbScheduledPost[]; paging?: { next?: string; cursors?: { after?: string } };
    };
    all.push(...(res.data ?? []));
    after = res.paging?.next ? res.paging.cursors?.after : undefined;
    if (!after) break;
  }
  return all;
}

async function adoptStalePushing(access: PageAccess, usable: Set<string>, deadline: number, out: ReconcileResult): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_PUSHING_MIN * 60_000).toISOString();
  const candidates = await collectUsableRows<PsPost>(usable, 100, async (from, to) => {
    const { data, error } = await createServiceClient().from('ps_posts').select('*')
      .eq('status', 'pushing').lt('claimed_at', cutoff).order('claimed_at', { ascending: true }).order('id').range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as PsPost[];
  }, async (dead) => {
    out.uncertain += await failDisconnected(dead, 'pushing', 'claimed_at', `Uncertain push outcome - ${DISCONNECTED_MSG} - check Business Suite before retry`);
  });

  for (const [, rows] of groupByPage(candidates)) {
    if (Date.now() > deadline) return;
    const { user_id: userId, page_id: pageId } = rows[0];
    const token = await access.token(userId, pageId);
    if (!token) { out.skipped_pages++; continue; }
    let fbPosts: FbScheduledPost[];
    try {
      fbPosts = await listScheduled(token, pageId);
    } catch (err) {
      if (classifyFbError(err) === 'auth') await access.invalidate(userId, pageId, err instanceof Error ? err.message : 'Token invalid');
      out.skipped_pages++;
      continue;
    }
    const taken = new Set<string>();
    for (const row of rows) {
      const d = decideAdoption(row, fbPosts.filter((p) => !taken.has(p.id)));
      if (d.action === 'adopt') {
        taken.add(d.fbPostId);
        const ok = await guarded(row.id, 'pushing', { status: 'scheduled', fb_post_id: d.fbPostId, pushed_at: nowIso(), error: null, error_code: null });
        if (ok) out.adopted++;
        else if (await guarded(row.id, 'pushing', { status: 'failed', error: 'Uncertain push outcome - check Business Suite before retry', error_code: null })) out.uncertain++;
      } else if (await guarded(row.id, 'pushing', { status: 'failed', error: d.error, error_code: null })) {
        out.uncertain++;
      }
    }
  }
}

export async function reconcilePosts(deadline: number): Promise<ReconcileResult> {
  const out: ReconcileResult = { published: 0, failed: 0, adopted: 0, uncertain: 0, skipped_pages: 0 };
  const access = createPageAccess();
  const errors: string[] = [];
  const usable = await loadUsablePageKeys();
  for (const step of [reconcileScheduled, adoptStalePushing]) {
    try { await step(access, usable, deadline, out); } catch (err) { errors.push(err instanceof Error ? err.message : String(err)); }
  }
  if (errors.length) throw new Error(errors.join('; '));
  return out;
}
