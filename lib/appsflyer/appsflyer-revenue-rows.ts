/**
 * Turns AppsFlyer ad- or campaign-level revenue into the campaign/ad-set revenue rows every dashboard
 * already consumes (AdjustRow — the name predates AppsFlyer; aggregation, merge, ROAS/profit,
 * app filter and snapshots all key off it unchanged).
 *
 * The export has a single revenue figure, so it feeds both `revenue` (ROAS) and `all_revenue`
 * (%Profit / Profit) — a deliberate product decision, not an approximation of Adjust's split.
 */

import type { AdjustRow } from '@/lib/types';
import type { AppsflyerAdRow } from './appsflyer-csv-parser';

/** Where an ad lives on its ad platform (FB ad set or TikTok ad group as `adset_id`). */
export interface AdPlacement {
  campaign_id: string;
  adset_id: string;
}

export interface AppsflyerMatchResult {
  rows: AdjustRow[];
  matchedAds: number;
  matchedRevenue: number;
}

/** A "by Campaign ID" file needs no platform lookup: each row is its own campaign, with no ad set
 * (ad set / ad group rows then show no revenue). */
export function campaignFilePlacements(rows: AppsflyerAdRow[]): Record<string, AdPlacement> {
  return Object.fromEntries(rows.map((r) => [r.id, { campaign_id: r.id, adset_id: '' }]));
}

export function toRevenueRows(adRows: AppsflyerAdRow[], placements: Record<string, AdPlacement>): AppsflyerMatchResult {
  const rows: AdjustRow[] = [];
  let matchedRevenue = 0;
  for (const ad of adRows) {
    const place = placements[ad.id];
    if (!place) continue;
    matchedRevenue += ad.revenue;
    rows.push({
      campaign_id: place.campaign_id,
      campaign_name: '',
      app: ad.app,
      revenue: ad.revenue,
      all_revenue: ad.revenue,
      adset_id: place.adset_id || undefined,
    });
  }
  return { rows, matchedAds: rows.length, matchedRevenue };
}
