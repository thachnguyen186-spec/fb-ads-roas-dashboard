/**
 * Merges TikTok campaign/ad group rows with Adjust revenue data.
 * USD-only by construction (Plan 1, Validation Session 1 Q1) — Phase 2's account-selection
 * UI/route restricts advertiser selection to USD accounts, so no FX conversion is built here.
 * `currency !== 'USD'` is a defensive invariant check, not a supported code path.
 * Reuses lib/adjust/merge.ts's pure ROAS/Profit functions (DRY).
 */

import { computeRoas, computeProfit, computeProfitAmount } from '@/lib/adjust/merge';
import type {
  TiktokCampaignRow,
  TiktokAdGroupRow,
  MergedTiktokCampaign,
  MergedTiktokAdGroup,
} from '@/lib/types';
import type { TiktokSpendMetrics } from './reporting';

export function mergeTiktokCampaigns(
  rows: TiktokCampaignRow[],
  spendMap: Map<string, TiktokSpendMetrics>,
  adjustCohortMap: Map<string, number>,
  adjustAllRevMap: Map<string, number>,
): MergedTiktokCampaign[] {
  return rows.map((row) => {
    const merged = { ...row, ...(spendMap.get(row.campaign_id) ?? {}) };
    const isUsd = merged.currency === 'USD';
    const adjustRevenue = adjustCohortMap.get(row.campaign_id) ?? null;
    const adjustAllRevenue = adjustAllRevMap.get(row.campaign_id) ?? null;
    return {
      ...merged,
      adjust_revenue: adjustRevenue,
      adjust_all_revenue: adjustAllRevenue,
      roas: isUsd ? computeRoas(adjustRevenue, merged.spend) : null,
      profit_pct: isUsd ? computeProfit(adjustAllRevenue, merged.spend) : null,
      profit: isUsd ? computeProfitAmount(adjustAllRevenue, merged.spend) : null,
      has_adjust_data: adjustRevenue !== null || adjustAllRevenue !== null,
    };
  });
}

export function mergeTiktokAdGroups(
  rows: TiktokAdGroupRow[],
  spendMap: Map<string, TiktokSpendMetrics>,
  adjustCohortMap: Map<string, number>,
  adjustAllRevMap: Map<string, number>,
): MergedTiktokAdGroup[] {
  return rows.map((row) => {
    const merged = { ...row, ...(spendMap.get(row.adgroup_id) ?? {}) };
    const isUsd = merged.currency === 'USD';
    const adjustRevenue = adjustCohortMap.get(row.adgroup_id) ?? null;
    const adjustAllRevenue = adjustAllRevMap.get(row.adgroup_id) ?? null;
    return {
      ...merged,
      adjust_revenue: adjustRevenue,
      adjust_all_revenue: adjustAllRevenue,
      roas: isUsd ? computeRoas(adjustRevenue, merged.spend) : null,
      profit_pct: isUsd ? computeProfit(adjustAllRevenue, merged.spend) : null,
      profit: isUsd ? computeProfitAmount(adjustAllRevenue, merged.spend) : null,
      has_adjust_data: adjustRevenue !== null || adjustAllRevenue !== null,
    };
  });
}
