/**
 * Revenue aggregators shared by the FB and TikTok dashboards.
 *
 * Input rows are `AdjustRow` (the type name predates AppsFlyer); today they come from the
 * AppsFlyer "by Ad ID" CSV via `lib/appsflyer/appsflyer-revenue-rows.ts`. Each entity gets two maps:
 *   - `revenue`     → ROAS numerator
 *   - `all_revenue` → %Profit and Profit
 * (AppsFlyer provides a single figure, so both maps hold the same values.)
 *
 * Runs entirely client-side.
 */

import type { AdjustRow } from '@/lib/types';

/**
 * Aggregates rows by campaign_id, summing `revenue`.
 * Used for ROAS = revenue / spend.
 */
export function aggregateByCampaignId(rows: AdjustRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.campaign_id, (map.get(row.campaign_id) ?? 0) + row.revenue);
  }
  return map;
}

/**
 * Aggregates rows by campaign_id, summing all_revenue.
 * Used for %Profit and Profit = (all_revenue - spend) calculations.
 */
export function aggregateAllRevByCampaignId(rows: AdjustRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.campaign_id, (map.get(row.campaign_id) ?? 0) + row.all_revenue);
  }
  return map;
}

/**
 * Returns a map of campaign_id → app_name from revenue rows.
 * Used to populate the App filter dropdown (FB API app_name is often null).
 */
export function aggregateAppByCampaignId(rows: AdjustRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.app && !map.has(row.campaign_id)) {
      map.set(row.campaign_id, row.app);
    }
  }
  return map;
}

/**
 * Aggregates rows by adset_id, summing `revenue`.
 * Used for adset-level ROAS in the expanded view.
 */
export function aggregateByAdSetId(rows: AdjustRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row.adset_id) continue;
    map.set(row.adset_id, (map.get(row.adset_id) ?? 0) + row.revenue);
  }
  return map;
}

/**
 * Aggregates rows by adset_id, summing all_revenue.
 * Used for adset-level %Profit and Profit in the expanded view.
 */
export function aggregateAllRevByAdSetId(rows: AdjustRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row.adset_id) continue;
    map.set(row.adset_id, (map.get(row.adset_id) ?? 0) + row.all_revenue);
  }
  return map;
}
