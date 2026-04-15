/**
 * Merges Facebook campaign rows with Adjust revenue data.
 * Left join: all FB campaigns shown, Adjust data attached when campaign_id matches.
 * ROAS = cohort_revenue / fb_spend (null when spend=0 or no Adjust match).
 */

import type { AdSetRow, CampaignRow, MergedAdSet, MergedCampaign } from '@/lib/types';

export function computeRoas(revenue: number | null, spend: number): number | null {
  if (revenue === null || spend === 0) return null;
  return revenue / spend;
}

/** %Profit = (revenue - spend) / spend * 100. Null when no data or spend === 0. */
export function computeProfit(revenue: number | null, spend: number): number | null {
  if (revenue === null || spend === 0) return null;
  return ((revenue - spend) / spend) * 100;
}

/** Format profit as "35.50%" or "—" */
export function formatProfit(pct: number | null): string {
  if (pct === null) return '—';
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

export function mergeCampaigns(
  fbCampaigns: CampaignRow[],
  adjustMap: Map<string, number>,
  vndRate: number = 26000,
): MergedCampaign[] {
  return fbCampaigns.map((campaign) => {
    const isVnd = campaign.currency === 'VND';
    const insightRate = isVnd ? vndRate : 1;
    // Budgets: centsToUsd divides by 100, but VND has no sub-unit, so multiply back by 100/vndRate for USD.
    const budgetFactor = isVnd ? 100 / vndRate : 1;
    const adjustRevenue = adjustMap.get(campaign.campaign_id) ?? null;
    const spendUsd = campaign.spend / insightRate;
    return {
      ...campaign,
      spend: spendUsd,
      cpm: campaign.cpm / insightRate,
      cpc: campaign.cpc / insightRate,
      daily_budget: campaign.daily_budget !== null ? campaign.daily_budget * budgetFactor : null,
      lifetime_budget: campaign.lifetime_budget !== null ? campaign.lifetime_budget * budgetFactor : null,
      budget_remaining: campaign.budget_remaining !== null ? campaign.budget_remaining * budgetFactor : null,
      adjust_revenue: adjustRevenue,
      roas: computeRoas(adjustRevenue, spendUsd),
      profit_pct: computeProfit(adjustRevenue, spendUsd),
      has_adjust_data: adjustRevenue !== null,
    };
  });
}

/** Merges FB ad set rows with Adjust ad set revenue, applying VND conversion if needed */
export function mergeAdSets(
  fbAdSets: AdSetRow[],
  adjustAdSetMap: Map<string, number>,
  vndRate: number = 26000,
): MergedAdSet[] {
  return fbAdSets.map((adset) => {
    const isVnd = adset.currency === 'VND';
    // Insights (spend/cpm/cpc) are returned as VND numbers → divide by vndRate for USD.
    // Budgets are returned in VND smallest unit (1 VND), but centsToUsd already divided by 100,
    // so to get USD: multiply by 100 then divide by vndRate (= multiply by 100/vndRate).
    const insightRate = isVnd ? vndRate : 1;
    const budgetFactor = isVnd ? 100 / vndRate : 1;
    const adjustRevenue = adjustAdSetMap.get(adset.adset_id) ?? null;
    const spendUsd = adset.spend / insightRate;
    return {
      ...adset,
      spend: spendUsd,
      cpm: adset.cpm / insightRate,
      cpc: adset.cpc / insightRate,
      daily_budget: adset.daily_budget !== null ? adset.daily_budget * budgetFactor : null,
      lifetime_budget: adset.lifetime_budget !== null ? adset.lifetime_budget * budgetFactor : null,
      budget_remaining: adset.budget_remaining !== null ? adset.budget_remaining * budgetFactor : null,
      adjust_revenue: adjustRevenue,
      roas: computeRoas(adjustRevenue, spendUsd),
      profit_pct: computeProfit(adjustRevenue, spendUsd),
      has_adjust_data: adjustRevenue !== null,
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
