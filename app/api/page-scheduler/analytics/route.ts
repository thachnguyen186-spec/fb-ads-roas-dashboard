/**
 * GET /api/page-scheduler/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD&page_id=&sort=&owner=all|me|<uuid>
 *   -> { posts: top 200 published posts, totals: per-Page totals, owners, truncated }
 * Dates are Bangkok days (by published_at). Visibility via resolveOwnerFilter (staff own, leader
 * team, admin all); `owner` outside the visible set -> 403. Read-only.
 */

import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { getPsContext, ownerLabels, resolveOwnerFilter } from '@/lib/page-scheduler/access';
import { isSortKey, pageTotals, topPosts, type AnalyticsRow } from '@/lib/page-scheduler/analytics-aggregate';

const TOP_LIMIT = 200;
const PAGE = 1000;
const MAX_PAGES = 5;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const COLUMNS = 'id, user_id, page_id, page_name, message, published_at, permalink_url, reactions, comments, shares, views, clicks, engagement, metrics_at, metrics_error';

function dayBound(day: string | null, end: boolean): string | null {
  if (!day) return null;
  const ms = Date.parse(`${day}T${end ? '23:59:59.999' : '00:00:00.000'}+07:00`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export async function GET(request: NextRequest) {
  const ctx = await getPsContext();
  if (ctx instanceof Response) return ctx;
  const params = request.nextUrl.searchParams;
  const ids = resolveOwnerFilter(ctx, params.get('owner'));
  if (ids instanceof Response) return ids;

  const from = params.get('from'), to = params.get('to');
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) return errorResponse('from/to must be YYYY-MM-DD', 400);
  const sortParam = params.get('sort');
  const sort = isSortKey(sortParam) ? sortParam : 'engagement';
  const pageId = params.get('page_id');
  if (pageId && !/^\d{1,30}$/.test(pageId)) return errorResponse('Invalid page_id', 400);
  const fromIso = dayBound(from, false), toIso = dayBound(to, true);

  const service = createServiceClient();
  const rows: AnalyticsRow[] = [];
  let truncated = false;
  for (let p = 0; p < MAX_PAGES; p++) {
    let q = service.from('ps_posts').select(COLUMNS).eq('status', 'published').in('user_id', ids);
    if (pageId) q = q.eq('page_id', pageId);
    if (fromIso) q = q.gte('published_at', fromIso);
    if (toIso) q = q.lte('published_at', toIso);
    const { data, error } = await q.order('published_at', { ascending: false }).order('id').range(p * PAGE, p * PAGE + PAGE - 1);
    if (error) return errorResponse(error.message, 500);
    rows.push(...((data ?? []) as AnalyticsRow[]));
    if ((data?.length ?? 0) < PAGE) break;
    if (p === MAX_PAGES - 1) truncated = true;
  }

  const owners = await ownerLabels(ctx.visibleUserIds);
  const withOwner = topPosts(rows, sort, TOP_LIMIT).map((r) => ({ ...r, owner_email: owners[r.user_id] ?? null }));
  return Response.json({ posts: withOwner, totals: pageTotals(rows), owners, truncated });
}
