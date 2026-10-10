/** Pure reconcile decisions (no I/O) so they can be unit-tested. */

import { UNPUBLISHED_FAIL_HOURS } from './constants';
import { classifyFbError } from './graph-errors';
import type { GraphBatchItem, PsPost } from './types';

export type ReconcileDecision =
  | { action: 'published'; permalink: string | null }
  | { action: 'failed'; error: string }
  | { action: 'pending' }
  | { action: 'auth'; error: string }
  | { action: 'skip' };

/** Decide what a `scheduled` post's node read means once its time has passed. */
export function decideScheduled(item: GraphBatchItem, scheduledAtMs: number, nowMs: number): ReconcileDecision {
  if (!item.ok) {
    const cls = classifyFbError(item.error);
    if (cls === 'not_found' || item.status === 404) return { action: 'failed', error: 'Post missing on Facebook (deleted or never created)' };
    if (cls === 'auth') return { action: 'auth', error: item.error?.message ?? 'Token invalid' };
    return { action: 'skip' };
  }
  const body = (item.body ?? {}) as { is_published?: unknown; permalink_url?: unknown };
  if (body.is_published === true) {
    const link = typeof body.permalink_url === 'string' ? body.permalink_url : null;
    return { action: 'published', permalink: link && link.startsWith('/') ? `https://www.facebook.com${link}` : link };
  }
  if (nowMs - scheduledAtMs > UNPUBLISHED_FAIL_HOURS * 3_600_000) {
    return { action: 'failed', error: `Still unpublished ${UNPUBLISHED_FAIL_HOURS}h after its scheduled time - check Facebook` };
  }
  return { action: 'pending' };
}

export interface FbScheduledPost { id: string; message?: string; scheduled_publish_time?: number | string }

const PREFIX = 100;
const norm = (s: string | undefined | null) => (s ?? '').trim().slice(0, PREFIX);

export type AdoptDecision = { action: 'adopt'; fbPostId: string } | { action: 'uncertain'; error: string };

/** Match a stale `pushing` row against the Page's scheduled posts: exact unix time + message prefix. */
export function decideAdoption(row: Pick<PsPost, 'scheduled_at' | 'message'>, fbPosts: FbScheduledPost[]): AdoptDecision {
  const unix = Math.floor(Date.parse(row.scheduled_at) / 1000);
  const want = norm(row.message);
  const matches = fbPosts.filter((p) => Number(p.scheduled_publish_time) === unix && norm(p.message) === want);
  if (matches.length === 1) return { action: 'adopt', fbPostId: matches[0].id };
  return {
    action: 'uncertain',
    error: matches.length > 1
      ? 'Uncertain push outcome (several similar posts on Facebook) - check Business Suite before retry'
      : 'Uncertain push outcome - check Business Suite before retry',
  };
}
