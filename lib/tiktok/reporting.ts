/**
 * Fetches today's spend/impressions/clicks/cpc from TikTok's Reporting API.
 * /campaign/get/ and /adgroup/get/ only return budget — actual spend comes from here.
 *
 * Timezone note: TikTok's documented Reporting API params are UTC-only — no
 * utc_offset/timezone override was found (unlike Adjust's utc_offset param used in
 * lib/adjust/api-client.ts). "Today" below is therefore the UTC calendar day, which can
 * disagree with Adjust's Asia/Bangkok "today" by up to 7 hours at the day boundary.
 * This is the same UTC-vs-Bangkok mismatch class already fixed once for FB — Phase 3 must
 * surface this drift explicitly in the UI, not just document it here.
 */

import { tiktokGet } from './tiktok-client';

const PAGE_SIZE = 100;

export type TiktokDataLevel = 'CAMPAIGN' | 'ADGROUP';

/** TikTok's Reporting API rejects bare 'CAMPAIGN'/'ADGROUP' — it requires the auction-prefixed
 * variant (confirmed via TikTok's own rejection message naming the accepted enum). AUCTION_* is
 * the standard self-serve ad type; RESERVATION_* is for reserved placements (e.g. TopView),
 * not used by this app. */
const DATA_LEVEL_API_VALUE: Record<TiktokDataLevel, string> = {
  CAMPAIGN: 'AUCTION_CAMPAIGN',
  ADGROUP: 'AUCTION_ADGROUP',
};

export interface TiktokSpendMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  cpc: number;
}

interface RawReportRow {
  dimensions: { campaign_id?: string; adgroup_id?: string };
  metrics: { spend?: string; impressions?: string; clicks?: string; cpc?: string };
}

interface PageInfo {
  page: number;
  page_size: number;
  total_number: number;
}

interface RawReportResponse {
  list: RawReportRow[];
  page_info: PageInfo;
}

function toNum(val: string | undefined): number {
  const n = parseFloat(val ?? '0');
  return isNaN(n) ? 0 : n;
}

/** Returns a map keyed by campaign_id (CAMPAIGN level) or adgroup_id (ADGROUP level). */
export async function fetchTodaySpend(
  token: string,
  advertiserId: string,
  dataLevel: TiktokDataLevel,
): Promise<Map<string, TiktokSpendMetrics>> {
  const today = new Date().toISOString().slice(0, 10); // UTC "today" — see module note above
  const idField = dataLevel === 'CAMPAIGN' ? 'campaign_id' : 'adgroup_id';
  const map = new Map<string, TiktokSpendMetrics>();

  let page = 1;
  for (;;) {
    const data = await tiktokGet<RawReportResponse>('/report/integrated/get/', {
      advertiser_id: advertiserId,
      start_date: today,
      end_date: today,
      dimensions: JSON.stringify([idField]),
      metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'cpc']),
      report_type: 'BASIC',
      data_level: DATA_LEVEL_API_VALUE[dataLevel],
      page: String(page),
      page_size: String(PAGE_SIZE),
    }, token);

    const batch = data.list ?? [];
    for (const row of batch) {
      const id = row.dimensions[idField as 'campaign_id' | 'adgroup_id'];
      if (!id) continue;
      map.set(id, {
        spend: toNum(row.metrics.spend),
        impressions: toNum(row.metrics.impressions),
        clicks: toNum(row.metrics.clicks),
        cpc: toNum(row.metrics.cpc),
      });
    }

    if (batch.length === 0 || page * PAGE_SIZE >= data.page_info.total_number) break;
    page += 1;
  }

  return map;
}
