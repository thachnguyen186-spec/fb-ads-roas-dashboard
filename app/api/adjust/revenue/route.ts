/**
 * GET /api/adjust/revenue
 * Fetches today's Adjust revenue data using org-level env tokens.
 * Returns { rows: AdjustRow[] } — same shape as parseAdjustCsv() output.
 *
 * Env vars required (server-side only):
 *   ADJUST_API_TOKEN   — Bearer token for the Adjust Reports API
 *   ADJUST_APP_TOKEN   — Comma-separated Adjust app token(s)
 *
 * Query params:
 *   app  (optional) — restrict rows to a specific app name
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

  const appTokens = (process.env.ADJUST_APP_TOKEN ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (appTokens.length === 0) {
    return errorResponse('ADJUST_APP_TOKEN env variable not configured on server.', 400);
  }

  const appFilter = request.nextUrl.searchParams.get('app') || undefined;

  try {
    const rows = await fetchAdjustRevenueToday(token, appTokens, appFilter);
    return Response.json({ rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch from Adjust API';
    return errorResponse(msg, 502);
  }
}
