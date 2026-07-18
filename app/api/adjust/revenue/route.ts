/**
 * GET /api/adjust/revenue
 * Fetches today's Adjust revenue data using org-level env tokens.
 * Returns { rows: AdjustRow[] } — same shape as parseAdjustCsv() output.
 *
 * Env vars required (server-side only):
 *   ADJUST_API_TOKEN    — Bearer token for the Adjust Reports API
 *   ADJUST_ACCOUNT_ID   — Adjust account ID (adjust_account_id__in) — required because a single
 *                         Adjust login can have access to multiple accounts
 *   ADJUST_APP_TOKEN    — Optional: comma-separated Adjust app token(s) to restrict the query to.
 *                         If unset, all apps visible under ADJUST_ACCOUNT_ID are auto-discovered.
 *
 * Query params:
 *   app      (optional) — restrict rows to a specific app name
 *   partner  (optional) — 'facebook' (default) | 'tiktok'
 *
 * Errors:
 *   400 — env tokens not configured
 *   401 — unauthenticated
 *   502 — Adjust API call failed
 */

import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { fetchAdjustRevenueToday } from '@/lib/adjust/api-client';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  // Org-wide tokens from server environment — never from the client or DB
  const token = process.env.ADJUST_API_TOKEN;
  if (!token) return errorResponse('ADJUST_API_TOKEN env variable not configured on server.', 400);

  const accountId = process.env.ADJUST_ACCOUNT_ID;
  if (!accountId) return errorResponse('ADJUST_ACCOUNT_ID env variable not configured on server.', 400);

  // Optional: restrict to specific apps. Unset = auto-discover all apps on the account.
  const appTokens = (process.env.ADJUST_APP_TOKEN ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const appFilter = request.nextUrl.searchParams.get('app') || undefined;
  const partner = request.nextUrl.searchParams.get('partner') === 'tiktok' ? 'tiktok' : 'facebook';

  try {
    const rows = await fetchAdjustRevenueToday(token, accountId, appTokens, appFilter, partner);
    return Response.json({ rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch from Adjust API';
    return errorResponse(msg, 502);
  }
}
