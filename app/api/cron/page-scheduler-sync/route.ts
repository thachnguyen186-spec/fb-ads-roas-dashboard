/**
 * GET /api/cron/page-scheduler-sync
 * Hourly (minute 15) Vercel Cron for the Page Scheduler:
 *   1. deferred push of 'waiting' rows now inside Facebook's window (time-critical, runs first),
 *      plus 'queued' rows abandoned by the browser loop (idle > 30 min)
 *   2. reconcile 'scheduled' -> published/failed, adopt/fail stale 'pushing' rows
 *   3. metrics refresh (reactions/comments/shares/insights) for recent published posts
 * Each step is isolated: one failing step never blocks the others. Bounded by CRON_BUDGET_MS.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET} (Vercel Cron sends it automatically).
 */

import { NextRequest } from 'next/server';
import { verifyCronRequest } from '@/lib/cron-auth';
import { CRON_BUDGET_MS } from '@/lib/page-scheduler/constants';
import { pushDueWaiting } from '@/lib/page-scheduler/deferred-push';
import { pushIdleQueued } from '@/lib/page-scheduler/queued-sweep';
import { reconcilePosts } from '@/lib/page-scheduler/reconcile-posts';
import { refreshMetrics } from '@/lib/page-scheduler/metrics-sync';

export const maxDuration = 60;

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[page-scheduler-sync] ${name} failed: ${message}`);
    return { error: message.slice(0, 300) };
  }
}

export async function GET(request: NextRequest) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  const started = Date.now();
  const deadline = started + CRON_BUDGET_MS;
  const deferred = await step('deferred-push', () => pushDueWaiting(deadline));
  const queued = await step('queued-sweep', () => pushIdleQueued(deadline));
  const reconcile = await step('reconcile', () => reconcilePosts(deadline));
  const metrics = await step('metrics', () => refreshMetrics(deadline));
  const ms = Date.now() - started;
  console.log(`[page-scheduler-sync] ${JSON.stringify({ deferred, queued, reconcile, metrics, ms })}`);
  return Response.json({ deferred, reconcile, metrics, ms });
}
