/**
 * GET /api/adjust/revenue
 * Fetches today's Adjust revenue data using the user's stored API token.
 * Returns { rows: AdjustRow[] } — same shape as parseAdjustCsv() output.
 *
 * Query params:
 *   app  (optional) — restrict rows to a specific app name
 *
 * Errors:
 *   400 — no Adjust API token configured
 *   401 — unauthenticated
 *   502 — Adjust API call failed
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { fetchAdjustRevenueToday } from '@/lib/adjust/api-client';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  // Read token from DB server-side only — never from client request
  const service = createServiceClient();
  const { data: profile } = await service
    .from('profiles')
    .select('adjust_api_token, adjust_app_token')
    .eq('id', user.id)
    .single();

  const p = profile as { adjust_api_token?: string | null; adjust_app_token?: string | null } | null;
  const token = p?.adjust_api_token;
  if (!token) return errorResponse('Adjust API token not configured. Add it in Settings.', 400);

  // adjust_app_token stored as comma-separated list (e.g. "abc123,def456")
  const appTokens = (p?.adjust_app_token ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (appTokens.length === 0) {
    return errorResponse('Adjust app token(s) not configured. Add them in Settings → Adjust App Token field.', 400);
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
