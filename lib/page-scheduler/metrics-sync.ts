/**
 * Cron step 4: refresh engagement + insights for posts published in the last 14 days.
 * Per post: one node read (reactions/comments/shares) + one combined insights read; if the
 * combined read fails (e.g. one provisional metric name is invalid) it is retried per metric so
 * the valid metrics still land. Latest snapshot only, stored on ps_posts.
 */

import { createServiceClient } from '@/lib/supabase/server';
import {
  METRICS_MAX_POSTS_PER_RUN, METRICS_REFRESH_HOURS, METRICS_WINDOW_DAYS,
} from './constants';
import { collectUsableRows, createPageAccess, groupByPage, loadUsablePageKeys, type PageAccess } from './cron-page-access';
import { graphBatch } from './graph-batch';
import { classifyFbError } from './graph-errors';
import { buildMetricsPatch, INSIGHT_METRICS, mergeInsightItems, parseEngagement } from './metrics-parse';
import type { GraphBatchItem, PsPost } from './types';

export interface MetricsResult { updated: number; missing: number; skipped_pages: number }

const NODE_FIELDS = 'shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)';
const insightsUrl = (id: string, metrics: string[]) => `${id}/insights?metric=${metrics.join(',')}`;

async function save(id: string, patch: Record<string, unknown>): Promise<boolean> {
  const { error } = await createServiceClient().from('ps_posts')
    .update({ ...patch, metrics_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id);
  if (error) console.error(`[page-scheduler] metrics save failed for ${id}: ${error.message}`);
  return !error;
}

async function refreshPage(access: PageAccess, rows: PsPost[], out: MetricsResult): Promise<void> {
  const { user_id: userId, page_id: pageId } = rows[0];
  const token = await access.token(userId, pageId);
  if (!token) { out.skipped_pages++; return; }

  const reqs = rows.flatMap((r) => [
    { method: 'GET' as const, relative_url: `${r.fb_post_id}?fields=${NODE_FIELDS}` },
    { method: 'GET' as const, relative_url: insightsUrl(r.fb_post_id as string, INSIGHT_METRICS) },
  ]);
  const items = await graphBatch(token, reqs);

  // Round 2: per-metric retry only for posts whose combined insights read failed (non-auth).
  const retryIdx = rows.map((_, i) => i).filter((i) => !items[2 * i + 1].ok && items[2 * i].ok && classifyFbError(items[2 * i + 1].error) !== 'auth');
  const perMetric = new Map<number, GraphBatchItem[]>();
  if (retryIdx.length) {
    const reqs2 = retryIdx.flatMap((i) => INSIGHT_METRICS.map((m) => ({ method: 'GET' as const, relative_url: insightsUrl(rows[i].fb_post_id as string, [m]) })));
    const items2 = await graphBatch(token, reqs2);
    retryIdx.forEach((i, k) => perMetric.set(i, items2.slice(k * INSIGHT_METRICS.length, (k + 1) * INSIGHT_METRICS.length)));
  }

  for (let i = 0; i < rows.length; i++) {
    const node = items[2 * i];
    if (!node.ok) {
      const cls = classifyFbError(node.error);
      if (cls === 'auth') { await access.invalidate(userId, pageId, node.error?.message ?? 'Token invalid'); out.skipped_pages++; return; }
      if (cls === 'not_found' || node.status === 404) {
        if (await save(rows[i].id, { metrics_error: 'Post not found on Facebook' })) out.missing++;
      }
      continue; // transient / unknown: keep old snapshot, retry next run
    }
    const insights = mergeInsightItems(perMetric.get(i) ?? [items[2 * i + 1]]);
    if (await save(rows[i].id, { ...buildMetricsPatch(parseEngagement(node.body), insights) })) out.updated++;
  }
}

export async function refreshMetrics(deadline: number): Promise<MetricsResult> {
  const out: MetricsResult = { updated: 0, missing: 0, skipped_pages: 0 };
  const now = Date.now();
  const since = new Date(now - METRICS_WINDOW_DAYS * 86_400_000).toISOString();
  const stale = new Date(now - METRICS_REFRESH_HOURS * 3_600_000).toISOString();
  const usable = await loadUsablePageKeys();
  const rows = await collectUsableRows<PsPost>(usable, METRICS_MAX_POSTS_PER_RUN, async (from, to) => {
    const { data, error } = await createServiceClient().from('ps_posts').select('*')
      .eq('status', 'published').not('fb_post_id', 'is', null).gte('published_at', since)
      .or(`metrics_at.is.null,metrics_at.lt.${stale}`)
      .order('metrics_at', { ascending: true, nullsFirst: true }).order('id').range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as PsPost[];
  }, async (dead) => { // stamp metrics_at so token-less pages rotate to the back instead of starving others
    const ts = new Date().toISOString();
    for (let i = 0; i < dead.length; i += 100) {
      const { error: e } = await createServiceClient().from('ps_posts')
        .update({ metrics_error: 'Page disconnected - cannot refresh metrics', metrics_at: ts, updated_at: ts })
        .in('id', dead.slice(i, i + 100).map((r) => r.id));
      if (e) console.error(`[page-scheduler] metrics stamp failed: ${e.message}`);
    }
  });

  const access = createPageAccess();
  for (const [, pageRows] of groupByPage(rows)) {
    if (Date.now() > deadline) break;
    try { await refreshPage(access, pageRows, out); } catch (err) {
      console.error('[page-scheduler] metrics page error:', err instanceof Error ? err.message : err);
      out.skipped_pages++;
    }
  }
  return out;
}
