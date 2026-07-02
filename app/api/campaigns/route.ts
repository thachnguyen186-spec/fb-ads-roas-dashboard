/**
 * GET /api/campaigns[?viewAs=userId]
 * Fetches today's active Facebook campaigns across ALL of the user's selected
 * ad accounts in parallel. Each campaign row includes account_id + account_name.
 *
 * viewAs: optional — leader/admin can pass a staff user's ID to load
 * that user's campaigns using their token. Token never leaves the server.
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { canViewAs } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';
import { fetchCampaigns, fetchAppNames, type InsightDateParam } from '@/lib/facebook/campaigns';
import { fetchCampaignAppIds } from '@/lib/facebook/campaign-app-map';

/** FB date_preset keywords the export UI is allowed to request (prevents injection into the field spec). */
const PRESET_ALLOWLIST = new Set([
  'today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'this_month', 'last_month', 'maximum',
]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolves the insights date scope from query params.
 * Priority: since/until range → datePreset keyword → today (default).
 * Returns an errorResponse Response when validation fails.
 */
function resolveDateParam(sp: URLSearchParams): InsightDateParam | Response {
  const since = sp.get('since');
  const until = sp.get('until');
  if (since || until) {
    if (!since || !until || !DATE_RE.test(since) || !DATE_RE.test(until)) {
      return errorResponse('Invalid since/until — expected YYYY-MM-DD', 400);
    }
    if (since > until) return errorResponse('since must be on or before until', 400);
    return { since, until };
  }
  const preset = sp.get('datePreset');
  if (preset) {
    if (!PRESET_ALLOWLIST.has(preset)) return errorResponse('Unsupported datePreset', 400);
    return { preset };
  }
  return { preset: 'today' };
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const viewAs = request.nextUrl.searchParams.get('viewAs');
  const targetUserId = viewAs ?? user.id;

  if (viewAs && viewAs !== user.id) {
    const denied = await canViewAs(user.id, viewAs);
    if (denied) return denied;
  }

  const service = createServiceClient();

  // Load token + selected accounts for the target user in parallel
  const [profileRes, accountsRes] = await Promise.all([
    service.from('profiles').select('fb_access_token').eq('id', targetUserId).single(),
    service
      .from('fb_ad_accounts')
      .select('account_id, name, currency')
      .eq('user_id', targetUserId)
      .eq('is_selected', true),
  ]);

  if (!profileRes.data) return errorResponse('Profile not found', 404);
  const { fb_access_token } = profileRes.data as { fb_access_token: string | null };
  if (!fb_access_token) return errorResponse('Facebook access token not configured.', 400);

  const accounts = (accountsRes.data ?? []) as { account_id: string; name: string; currency: string }[];
  if (accounts.length === 0) return errorResponse('No ad accounts selected. Go to Settings.', 400);

  // Optional date scope (used by the Export-Spend feature); defaults to today.
  const dateParam = resolveDateParam(request.nextUrl.searchParams);
  if (dateParam instanceof Response) return dateParam;

  // Export-Spend passes appSource=adset to resolve each campaign's app from its
  // ad sets (app IDs live at ad-set level, not the campaign object). Off for the
  // normal dashboard load to avoid the extra per-account ad-sets fetch.
  const resolveAppsFromAdsets = request.nextUrl.searchParams.get('appSource') === 'adset';

  try {
    // Campaigns and the ad-set→app map are independent, so fetch both concurrently
    // (each is per-account parallel internally). Keeps the export within the function timeout.
    const [results, appIdMaps] = await Promise.all([
      Promise.all(accounts.map((a) => fetchCampaigns(fb_access_token, a.account_id, a.name, a.currency ?? 'USD', dateParam))),
      resolveAppsFromAdsets
        ? Promise.all(accounts.map((a) => fetchCampaignAppIds(fb_access_token, a.account_id)))
        : Promise.resolve([] as Map<string, string>[]),
    ]);
    const campaigns = results.flat();

    // Override each campaign's app_id with the ad-set-level app_id where available.
    if (resolveAppsFromAdsets) {
      const appIdByCampaign = new Map<string, string>();
      for (const m of appIdMaps) for (const [cid, appId] of m) appIdByCampaign.set(cid, appId);
      for (const c of campaigns) {
        const adsetAppId = appIdByCampaign.get(c.campaign_id);
        if (adsetAppId) c.app_id = adsetAppId;
      }
    }

    // Enrich campaigns with app names (best-effort, non-fatal)
    const appIds = campaigns.map((c) => c.app_id).filter((id): id is string => !!id);
    const appNameMap = await fetchAppNames(fb_access_token, appIds);
    for (const c of campaigns) {
      if (c.app_id) c.app_name = appNameMap.get(c.app_id) ?? null;
    }

    return Response.json({ campaigns });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch campaigns';
    const isTokenErr = /token|session|oauth|expired/i.test(message);
    return errorResponse(
      isTokenErr
        ? `Facebook token error: ${message}. Go to Settings and refresh your access token.`
        : message,
      502,
    );
  }
}
