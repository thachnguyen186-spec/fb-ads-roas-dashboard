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
}

export function filterTiktokCampaigns(
  campaigns: MergedTiktokCampaign[],
  filters: TiktokCampaignFilters,
): MergedTiktokCampaign[] {
  let list = [...campaigns];

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
