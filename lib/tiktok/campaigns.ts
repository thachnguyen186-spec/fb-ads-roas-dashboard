/**
 * Fetches campaigns/ad groups from TikTok Business API v1.3.
 * Spend/impressions/clicks/cpc default to 0 — filled in later by lib/tiktok/reporting.ts + merge.ts.
 * Paginates through all pages automatically (page_size capped at 100 by the API).
 */

import { tiktokGet } from './tiktok-client';
import type { TiktokCampaignRow, TiktokAdGroupRow } from '@/lib/types';

const PAGE_SIZE = 100;

interface RawCampaign {
  campaign_id: string;
  campaign_name: string;
  status: string;
  budget: number;
  budget_mode: string;
}

interface RawAdGroup {
  adgroup_id: string;
  adgroup_name: string;
  campaign_id: string;
  status: string;
  budget: number;
  budget_mode: string;
}

interface PageInfo {
  page: number;
  page_size: number;
  total_number: number;
}

interface RawListResponse<T> {
  list: T[];
  page_info: PageInfo;
}

/** Pages through a TikTok list endpoint (`/campaign/get/`, `/adgroup/get/`) collecting every raw row. */
async function fetchAllPages<T>(
  path: string,
  baseParams: Record<string, string>,
  token: string,
): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  for (;;) {
    const data = await tiktokGet<RawListResponse<T>>(path, {
      ...baseParams,
      page: String(page),
      page_size: String(PAGE_SIZE),
    }, token);
    const batch = data.list ?? [];
    items.push(...batch);
    if (batch.length === 0 || page * PAGE_SIZE >= data.page_info.total_number) break;
    page += 1;
  }
  return items;
}

export async function fetchCampaigns(
  token: string,
  advertiserId: string,
  advertiserName: string,
  currency: string,
): Promise<TiktokCampaignRow[]> {
  const raws = await fetchAllPages<RawCampaign>('/campaign/get/', { advertiser_id: advertiserId }, token);
  return raws.map((raw) => ({
    campaign_id: raw.campaign_id,
    campaign_name: raw.campaign_name,
    advertiser_id: advertiserId,
    advertiser_name: advertiserName,
    currency,
    status: raw.status,
    budget: raw.budget ?? 0,
    budget_mode: raw.budget_mode,
    spend: 0,
    impressions: 0,
    clicks: 0,
    cpc: 0,
  }));
}

/**
 * Confirms campaignId actually belongs to advertiserId before a control action mutates it —
 * advertiser-level selection alone doesn't prove ownership of a specific campaign within it
 * (Phase 4 Red Team Fix). Returns the campaign's real, freshly-fetched budget_mode so callers
 * validate budget minimums against TikTok's authoritative value instead of trusting whatever
 * budget_mode the client happened to send in the request body.
 */
export async function verifyCampaignOwnership(
  token: string,
  advertiserId: string,
  campaignId: string,
): Promise<{ budget_mode: string } | null> {
  const raws = await fetchAllPages<{ campaign_id: string; budget_mode: string }>(
    '/campaign/get/',
    { advertiser_id: advertiserId, filtering: JSON.stringify({ campaign_ids: [campaignId] }) },
    token,
  );
  const match = raws.find((r) => r.campaign_id === campaignId);
  return match ? { budget_mode: match.budget_mode } : null;
}

/** Same ownership check at ad-group level (Phase 4 Red Team Fix). */
export async function verifyAdGroupOwnership(
  token: string,
  advertiserId: string,
  adgroupId: string,
): Promise<{ budget_mode: string } | null> {
  const raws = await fetchAllPages<{ adgroup_id: string; budget_mode: string }>(
    '/adgroup/get/',
    { advertiser_id: advertiserId, filtering: JSON.stringify({ adgroup_ids: [adgroupId] }) },
    token,
  );
  const match = raws.find((r) => r.adgroup_id === adgroupId);
  return match ? { budget_mode: match.budget_mode } : null;
}

export async function fetchAdGroups(
  token: string,
  advertiserId: string,
  advertiserName: string,
  currency: string,
  campaignId?: string,
): Promise<TiktokAdGroupRow[]> {
  const baseParams: Record<string, string> = { advertiser_id: advertiserId };
  if (campaignId) baseParams.filtering = JSON.stringify({ campaign_ids: [campaignId] });

  const raws = await fetchAllPages<RawAdGroup>('/adgroup/get/', baseParams, token);
  return raws.map((raw) => ({
    adgroup_id: raw.adgroup_id,
    adgroup_name: raw.adgroup_name,
    campaign_id: raw.campaign_id,
    advertiser_id: advertiserId,
    advertiser_name: advertiserName,
    currency,
    status: raw.status,
    budget: raw.budget ?? 0,
    budget_mode: raw.budget_mode,
    spend: 0,
    impressions: 0,
    clicks: 0,
    cpc: 0,
  }));
}
