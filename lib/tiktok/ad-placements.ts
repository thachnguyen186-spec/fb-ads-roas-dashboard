/**
 * Resolves TikTok ad ids to their campaign + ad group via /ad/get/ (Business API v1.3).
 * Used to attach AppsFlyer ad-level revenue to the campaign/ad-group rows the dashboard shows.
 *
 * The caller does not know which advertiser owns each ad, so every advertiser is asked for the
 * ids still unresolved; ids found under one advertiser are dropped from later queries and the
 * scan stops as soon as nothing is pending. Advertisers run in small concurrent batches to stay
 * under TikTok's rate limit (same bound as the campaigns route).
 */

import { tiktokGet } from './tiktok-client';
import type { AdPlacement } from '@/lib/appsflyer/appsflyer-revenue-rows';

/** /ad/get/ accepts at most 100 ids per `filtering.ad_ids` and 100 rows per page. */
const ID_CHUNK = 100;
const PAGE_SIZE = 100;
const CONCURRENCY = 3;
const FIELDS = JSON.stringify(['ad_id', 'adgroup_id', 'campaign_id']);

interface RawAd {
  ad_id: string;
  adgroup_id: string;
  campaign_id: string;
}

interface RawAdList {
  list?: RawAd[];
  page_info?: { total_number?: number };
}

async function fetchAdChunk(token: string, advertiserId: string, adIds: string[]): Promise<RawAd[]> {
  const ads: RawAd[] = [];
  // STATUS_ALL includes deleted ads (excluded by default) — verified live: an ad deleted today can
  // still carry today's AppsFlyer revenue, and its campaign still needs that revenue.
  const filtering = JSON.stringify({ ad_ids: adIds, primary_status: 'STATUS_ALL' });
  for (let page = 1; ; page++) {
    const data = await tiktokGet<RawAdList>('/ad/get/', {
      advertiser_id: advertiserId,
      filtering,
      fields: FIELDS,
      page: String(page),
      page_size: String(PAGE_SIZE),
    }, token);
    const batch = data.list ?? [];
    ads.push(...batch);
    if (batch.length === 0 || page * PAGE_SIZE >= (data.page_info?.total_number ?? 0)) break;
  }
  return ads;
}

async function fetchAdsForAdvertiser(token: string, advertiserId: string, adIds: string[]): Promise<RawAd[]> {
  const ads: RawAd[] = [];
  for (let i = 0; i < adIds.length; i += ID_CHUNK) {
    ads.push(...await fetchAdChunk(token, advertiserId, adIds.slice(i, i + ID_CHUNK)));
  }
  return ads;
}

/** Returns placements for every id found under one of `advertiserIds`; unknown ids are simply absent.
 * Throws on any TikTok API error so a partial map never passes as complete revenue. */
export async function fetchAdPlacements(
  token: string,
  advertiserIds: string[],
  adIds: string[],
): Promise<Record<string, AdPlacement>> {
  const placements: Record<string, AdPlacement> = {};
  const pending = new Set(adIds);
  for (let i = 0; i < advertiserIds.length && pending.size > 0; i += CONCURRENCY) {
    const ids = [...pending];
    const batch = advertiserIds.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((advId) => fetchAdsForAdvertiser(token, advId, ids)));
    for (const ad of results.flat()) {
      const adId = String(ad.ad_id);
      if (!pending.has(adId)) continue;
      placements[adId] = { campaign_id: String(ad.campaign_id), adset_id: String(ad.adgroup_id ?? '') };
      pending.delete(adId);
    }
  }
  return placements;
}
