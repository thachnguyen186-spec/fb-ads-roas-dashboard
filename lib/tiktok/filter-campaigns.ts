/** Pure filter predicate for the TikTok dashboard hub — kept out of the component to stay under the 200-line file guideline. */

import type { MergedTiktokCampaign } from '@/lib/types';

export interface TiktokCampaignFilters {
  campaignName: string;
  statusFilter: 'all' | 'active' | 'inactive';
  accountFilter: string;
  roasMin: string;
  roasMax: string;
  spendMin: string;
  spendMax: string;
  budgetMin: string;
  budgetMax: string;
  /** Selected app names (multi-select). Empty = no app filter. */
  selectedApps?: string[];
}

export function filterTiktokCampaigns(
  campaigns: MergedTiktokCampaign[],
  filters: TiktokCampaignFilters,
  /** campaign_id -> app name derived from Adjust rows; required for selectedApps to match anything. */
  appByCampaignId: Map<string, string> = new Map(),
): MergedTiktokCampaign[] {
  let list = [...campaigns];

  if (filters.selectedApps && filters.selectedApps.length > 0 && appByCampaignId.size > 0) {
    const apps = filters.selectedApps;
    list = list.filter((c) => {
      const app = appByCampaignId.get(c.campaign_id);
      return app !== undefined && apps.includes(app);
    });
  }

  const name = filters.campaignName.trim().toLowerCase();
  if (name) list = list.filter((c) => c.campaign_name.toLowerCase().includes(name));
  if (filters.accountFilter) list = list.filter((c) => c.advertiser_id === filters.accountFilter);
  if (filters.statusFilter === 'active') list = list.filter((c) => c.status === 'ENABLE');
  if (filters.statusFilter === 'inactive') list = list.filter((c) => c.status !== 'ENABLE');

  const roasMinN = filters.roasMin !== '' ? parseFloat(filters.roasMin) : null;
  const roasMaxN = filters.roasMax !== '' ? parseFloat(filters.roasMax) : null;
  if (roasMinN !== null) list = list.filter((c) => c.roas !== null && c.roas >= roasMinN);
  if (roasMaxN !== null) list = list.filter((c) => c.roas !== null && c.roas <= roasMaxN);

  const spendMinN = filters.spendMin !== '' ? parseFloat(filters.spendMin) : null;
  const spendMaxN = filters.spendMax !== '' ? parseFloat(filters.spendMax) : null;
  if (spendMinN !== null) list = list.filter((c) => c.spend >= spendMinN);
  if (spendMaxN !== null) list = list.filter((c) => c.spend <= spendMaxN);

  const budgetMinN = filters.budgetMin !== '' ? parseFloat(filters.budgetMin) : null;
  const budgetMaxN = filters.budgetMax !== '' ? parseFloat(filters.budgetMax) : null;
  if (budgetMinN !== null) list = list.filter((c) => c.budget >= budgetMinN);
  if (budgetMaxN !== null) list = list.filter((c) => c.budget <= budgetMaxN);

  return list;
}
