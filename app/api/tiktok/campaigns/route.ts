/**
 * GET /api/tiktok/campaigns
 * Fetches today's TikTok campaigns across the target user's selected advertiser accounts,
 * overlaid with today's spend from the Reporting API. Target = ?viewAs (must pass canViewAs)
 * or the requester. Read is open to all roles; control routes use the requester's own token.
 *
 * getValidAccessToken(target) is called ONCE and reused for every advertiser (never
 * per-advertiser — fan-out contract). Advertisers are processed in small concurrent batches, not a single
 * unbounded Promise.all, to stay under TikTok's rate limit (Phase 1 Risk Assessment).
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { canViewAs } from '@/lib/auth-guards';
import { getValidAccessToken, describeAuthError } from '@/lib/tiktok/tiktok-connection';
import { fetchCampaigns, fetchAdGroups } from '@/lib/tiktok/campaigns';
import { fetchTodaySpend } from '@/lib/tiktok/reporting';
import type { TiktokAdvertiserAccount, TiktokCampaignRow, TiktokAdGroupRow } from '@/lib/types';

/** Advertisers processed per batch — bounded concurrency, not full fan-out. */
const CONCURRENCY = 3;

/** Ids with spend today. Only these are loaded: accounts carry thousands of idle campaigns,
 * and shipping them all made the dashboard slow (user request: today's spenders only). */
function idsWithSpend(spendMap: Map<string, { spend: number }>): string[] {
  return [...spendMap.entries()].filter(([, m]) => m.spend > 0).map(([id]) => id);
}

async function fetchForAdvertiser(token: string, account: TiktokAdvertiserAccount): Promise<TiktokCampaignRow[]> {
  const spendMap = await fetchTodaySpend(token, account.advertiser_id, 'CAMPAIGN');
  const ids = idsWithSpend(spendMap);
  if (ids.length === 0) return [];
  const campaigns = await fetchCampaigns(token, account.advertiser_id, account.name, account.currency, ids);
  return campaigns.map((c) => ({ ...c, ...(spendMap.get(c.campaign_id) ?? {}) }));
}

/** Ad-group equivalent of fetchForAdvertiser, used by the ?level=adgroup branch. */
async function fetchAdGroupsForAdvertiser(token: string, account: TiktokAdvertiserAccount): Promise<TiktokAdGroupRow[]> {
  const spendMap = await fetchTodaySpend(token, account.advertiser_id, 'ADGROUP');
  const ids = idsWithSpend(spendMap);
  if (ids.length === 0) return [];
  const adgroups = await fetchAdGroups(token, account.advertiser_id, account.name, account.currency, ids);
  return adgroups.map((a) => ({ ...a, ...(spendMap.get(a.adgroup_id) ?? {}) }));
}

export async function GET(request: NextRequest) {
  const level = request.nextUrl.searchParams.get('level') === 'adgroup' ? 'adgroup' : 'campaign';

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  // viewAs: leader/admin read another user's accounts with THAT user's token (read-only).
  const viewAs = request.nextUrl.searchParams.get('viewAs');
  const isViewAs = !!viewAs && viewAs !== user.id;
  const target = isViewAs ? viewAs : user.id;
  if (isViewAs) {
    const denied = await canViewAs(user.id, target);
    if (denied) return denied;
  }

  const service = createServiceClient();
  const { data, error: dbError } = await service
    .from('tiktok_ad_accounts')
    .select('advertiser_id,name,currency,is_selected')
    .eq('user_id', target)
    .eq('is_selected', true);
  if (dbError) return errorResponse('Failed to load TikTok advertiser accounts', 500);
  const accounts = (data ?? []) as TiktokAdvertiserAccount[];
  if (accounts.length === 0) {
    return errorResponse(
      isViewAs
        ? 'This user has no selected TikTok advertiser accounts.'
        : 'No TikTok advertiser accounts selected. Connect in Settings.',
      400,
    );
  }

  let token: string;
  try {
    token = await getValidAccessToken(target);
  } catch (err) {
    const { status, message } = describeAuthError(err);
    return errorResponse(message, status);
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
