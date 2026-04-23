/**
 * Merges Facebook campaign rows with Adjust revenue data.
 * Left join: all FB campaigns shown, Adjust data attached when campaign_id matches.
 *
 * D0 ROAS = cohort_all_revenue / fb_spend  (adjustCohortMap)
 * %Profit = (all_revenue - spend) / all_revenue * 100  (adjustAllRevMap)
 * Profit  = all_revenue - spend  (adjustAllRevMap)
 */

import type { AdSetRow, CampaignRow, MergedAdSet, MergedCampaign } from '@/lib/types';

export function computeRoas(cohortRevenue: number | null, spend: number): number | null {
  if (cohortRevenue === null || spend === 0) return null;
  return cohortRevenue / spend;
}

/** %Profit = (all_revenue - spend) / all_revenue * 100. Null when no data or all_revenue === 0. */
export function computeProfit(allRevenue: number | null, spend: number): number | null {
  if (allRevenue === null || allRevenue === 0) return null;
  return ((allRevenue - spend) / allRevenue) * 100;
}

/** Profit amount = all_revenue - spend. Null when no Adjust data. */
export function computeProfitAmount(allRevenue: number | null, spend: number): number | null {
  if (allRevenue === null) return null;
  return allRevenue - spend;
}

/** Format profit as "+35.50%" or "—" */
export function formatProfit(pct: number | null): string {
  if (pct === null) return '—';
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

/**
 * Merges FB campaigns with Adjust data.
 * @param adjustCohortMap  campaign_id → cohort_all_revenue (D0 ROAS numerator)
 * @param adjustAllRevMap  campaign_id → all_revenue (%Profit and Profit)
 */
export function mergeCampaigns(
  fbCampaigns: CampaignRow[],
  adjustCohortMap: Map<string, number>,
  adjustAllRevMap: Map<string, number>,
  vndRate: number = 26000,
): MergedCampaign[] {
  return fbCampaigns.map((campaign) => {
    const isVnd = campaign.currency === 'VND';
    const insightRate = isVnd ? vndRate : 1;
    // Budgets: centsToUsd divides by 100, but VND has no sub-unit, so multiply back by 100/vndRate for USD.
    const budgetFactor = isVnd ? 100 / vndRate : 1;
    const adjustRevenue = adjustCohortMap.get(campaign.campaign_id) ?? null;
    const adjustAllRevenue = adjustAllRevMap.get(campaign.campaign_id) ?? null;
    const spendUsd = campaign.spend / insightRate;
    return {
      ...campaign,
      spend: spendUsd,
      cpc: campaign.cpc / insightRate,
      cpi: campaign.cpi !== null ? campaign.cpi / insightRate : null,
      daily_budget: campaign.daily_budget !== null ? campaign.daily_budget * budgetFactor : null,
      lifetime_budget: campaign.lifetime_budget !== null ? campaign.lifetime_budget * budgetFactor : null,
      budget_remaining: campaign.budget_remaining !== null ? campaign.budget_remaining * budgetFactor : null,
      adjust_revenue: adjustRevenue,
      adjust_all_revenue: adjustAllRevenue,
      roas: computeRoas(adjustRevenue, spendUsd),
      profit_pct: computeProfit(adjustAllRevenue, spendUsd),
      profit: computeProfitAmount(adjustAllRevenue, spendUsd),
      has_adjust_data: adjustRevenue !== null || adjustAllRevenue !== null,
    };
  });
}

/**
 * Merges FB ad set rows with Adjust revenue, applying VND conversion if needed.
 * @param adjustCohortMap  adset_id → cohort_all_revenue (D0 ROAS numerator)
 * @param adjustAllRevMap  adset_id → all_revenue (%Profit and Profit)
 */
export function mergeAdSets(
  fbAdSets: AdSetRow[],
  adjustCohortMap: Map<string, number>,
  adjustAllRevMap: Map<string, number>,
  vndRate: number = 26000,
): MergedAdSet[] {
  return fbAdSets.map((adset) => {
    const isVnd = adset.currency === 'VND';
    // Insights (spend/cpc/cpi) are returned as VND numbers → divide by vndRate for USD.
    // Budgets are returned in VND smallest unit (1 VND), but centsToUsd already divided by 100,
    // so to get USD: multiply by 100 then divide by vndRate (= multiply by 100/vndRate).
    const insightRate = isVnd ? vndRate : 1;
    const budgetFactor = isVnd ? 100 / vndRate : 1;
    const adjustRevenue = adjustCohortMap.get(adset.adset_id) ?? null;
    const adjustAllRevenue = adjustAllRevMap.get(adset.adset_id) ?? null;
    const spendUsd = adset.spend / insightRate;
    return {
      ...adset,
      spend: spendUsd,
      cpc: adset.cpc / insightRate,
      cpi: adset.cpi !== null ? adset.cpi / insightRate : null,
      daily_budget: adset.daily_budget !== null ? adset.daily_budget * budgetFactor : null,
      lifetime_budget: adset.lifetime_budget !== null ? adset.lifetime_budget * budgetFactor : null,
      budget_remaining: adset.budget_remaining !== null ? adset.budget_remaining * budgetFactor : null,
      adjust_revenue: adjustRevenue,
      adjust_all_revenue: adjustAllRevenue,
      roas: computeRoas(adjustRevenue, spendUsd),
      profit_pct: computeProfit(adjustAllRevenue, spendUsd),
      profit: computeProfitAmount(adjustAllRevenue, spendUsd),
      has_adjust_data: adjustRevenue !== null || adjustAllRevenue !== null,
    };
  });
}

/** Tailwind text-color class for a ROAS value */
export function roasColorClass(roas: number | null): string {
  if (roas === null) return 'text-slate-400';
  if (roas >= 2) return 'text-emerald-600 font-medium';
  if (roas >= 1) return 'text-amber-600 font-medium';
  return 'text-red-600 font-medium';
}

/** Display string for ROAS: null → "—", number → "2.45x" */
export function formatRoas(roas: number | null): string {
  if (roas === null) return '—';
  return `${roas.toFixed(2)}x`;
}
