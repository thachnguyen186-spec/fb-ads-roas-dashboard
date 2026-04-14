/**
 * Merges Facebook campaign rows with Adjust revenue data.
 * Left join: all FB campaigns shown, Adjust data attached when campaign_id matches.
 * ROAS = cohort_revenue / fb_spend (null when spend=0 or no Adjust match).
 */

import type { CampaignRow, MergedCampaign } from '@/lib/types';

export function computeRoas(revenue: number | null, spend: number): number | null {
  if (revenue === null || spend === 0) return null;
  return revenue / spend;
}

export function mergeCampaigns(
  fbCampaigns: CampaignRow[],
  adjustMap: Map<string, number>,
): MergedCampaign[] {
  return fbCampaigns.map((campaign) => {
    const adjustRevenue = adjustMap.get(campaign.campaign_id) ?? null;
    return {
      ...campaign,
      adjust_revenue: adjustRevenue,
      roas: computeRoas(adjustRevenue, campaign.spend),
      has_adjust_data: adjustRevenue !== null,
    };
  });
}

/** Tailwind text-color class for a ROAS value */
export function roasColorClass(roas: number | null): string {
  if (roas === null) return 'text-gray-400';
  if (roas >= 2) return 'text-green-600 font-medium';
  if (roas >= 1) return 'text-yellow-600 font-medium';
  return 'text-red-600 font-medium';
}

/** Display string for ROAS: null → "—", number → "2.45x" */
export function formatRoas(roas: number | null): string {
  if (roas === null) return '—';
  return `${roas.toFixed(2)}x`;
}
