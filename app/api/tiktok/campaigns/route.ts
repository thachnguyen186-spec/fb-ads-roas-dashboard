/**
 * GET /api/tiktok/campaigns
 * Fetches today's TikTok campaigns across every selected advertiser account, overlaid with
 * today's spend from the Reporting API. Read access is intentionally open to all authenticated
 * users (Phase 3 Key Insights) — write/control actions are role-gated separately (Phase 4).
 *
 * getValidAccessToken() is called ONCE and reused for every advertiser (never per-advertiser —
 * Phase 1 fan-out contract). Advertisers are processed in small concurrent batches, not a single
 * unbounded Promise.all, to stay under TikTok's rate limit (Phase 1 Risk Assessment).
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { getValidAccessToken } from '@/lib/tiktok/tiktok-connection';
import { fetchCampaigns, fetchAdGroups } from '@/lib/tiktok/campaigns';
import { fetchTodaySpend } from '@/lib/tiktok/reporting';
import type { TiktokAdvertiserAccount, TiktokCampaignRow, TiktokAdGroupRow } from '@/lib/types';

/** Advertisers processed per batch — bounded concurrency, not full fan-out. */
const CONCURRENCY = 3;

async function fetchForAdvertiser(token: string, account: TiktokAdvertiserAccount): Promise<TiktokCampaignRow[]> {
  const [campaigns, spendMap] = await Promise.all([
    fetchCampaigns(token, account.advertiser_id, account.name, account.currency),
    fetchTodaySpend(token, account.advertiser_id, 'CAMPAIGN'),
  ]);
  return campaigns.map((c) => ({ ...c, ...(spendMap.get(c.campaign_id) ?? {}) }));
}

/** Ad-group equivalent of fetchForAdvertiser, used by the ?level=adgroup branch (Phase 4). */
async function fetchAdGroupsForAdvertiser(token: string, account: TiktokAdvertiserAccount): Promise<TiktokAdGroupRow[]> {
  const [adgroups, spendMap] = await Promise.all([
    fetchAdGroups(token, account.advertiser_id, account.name, account.currency),
    fetchTodaySpend(token, account.advertiser_id, 'ADGROUP'),
  ]);
  return adgroups.map((a) => ({ ...a, ...(spendMap.get(a.adgroup_id) ?? {}) }));
}

export async function GET(request: NextRequest) {
  const level = request.nextUrl.searchParams.get('level') === 'adgroup' ? 'adgroup' : 'campaign';

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const service = createServiceClient();
  const { data } = await service
    .from('tiktok_advertiser_accounts')
    .select('advertiser_id,name,currency,is_selected')
    .eq('is_selected', true);
  const accounts = (data ?? []) as TiktokAdvertiserAccount[];
  if (accounts.length === 0) {
    return errorResponse('No TikTok advertiser accounts selected. Connect in Settings.', 400);
  }

  let token: string;
  try {
    token = await getValidAccessToken();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'TIKTOK_NOT_CONNECTED') return errorResponse('TikTok is not connected. Connect in Settings.', 400);
    if (message === 'TIKTOK_RECONNECT_REQUIRED') return errorResponse('TikTok connection expired — reconnect in Settings.', 409);
    return errorResponse(message, 502);
  }

  try {
    if (level === 'adgroup') {
      const adgroups: TiktokAdGroupRow[] = [];
      for (let i = 0; i < accounts.length; i += CONCURRENCY) {
        const batch = accounts.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map((a) => fetchAdGroupsForAdvertiser(token, a)));
        adgroups.push(...results.flat());
      }
      return Response.json({ adgroups });
    }

    const campaigns: TiktokCampaignRow[] = [];
    for (let i = 0; i < accounts.length; i += CONCURRENCY) {
      const batch = accounts.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map((a) => fetchForAdvertiser(token, a)));
      campaigns.push(...results.flat());
    }
    return Response.json({ campaigns });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch TikTok campaigns';
    return errorResponse(message, 502);
  }
}
