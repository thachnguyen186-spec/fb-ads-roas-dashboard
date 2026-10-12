'use client';

import FilterBar from '@/app/dashboard/components/filter-bar';
import type { useTiktokFilterState } from './use-tiktok-filter-state';

interface Props {
  state: ReturnType<typeof useTiktokFilterState>;
  appOptions: string[];
  accountOptions: [string, string][];
  totalCount: number;
  filteredCount: number;
}

/** Reuses the FB FilterBar as-is (incl. its app multi-select); keyword-chip handlers are no-ops (feature not needed here). */
export default function TiktokFilterSection({ state: f, appOptions, accountOptions, totalCount, filteredCount }: Props) {
  const v = f.filters;
  return (
    <FilterBar
      campaignName={v.campaignName}
      onCampaignNameChange={f.setCampaignName}
      campaignNameKeywords={[]}
      onAddKeyword={() => {}}
      onRemoveKeyword={() => {}}
      statusFilter={v.statusFilter}
      onStatusFilterChange={f.setStatusFilter}
      selectedApps={v.selectedApps ?? []}
      onSelectedAppsChange={f.setSelectedApps}
      appOptions={appOptions}
      accountFilter={v.accountFilter}
      onAccountFilterChange={f.setAccountFilter}
      accountOptions={accountOptions}
      roasMin={v.roasMin} roasMax={v.roasMax}
      onRoasMinChange={f.setRoasMin} onRoasMaxChange={f.setRoasMax}
      spendMin={v.spendMin} spendMax={v.spendMax}
      onSpendMinChange={f.setSpendMin} onSpendMaxChange={f.setSpendMax}
      budgetMin={v.budgetMin} budgetMax={v.budgetMax}
      onBudgetMinChange={f.setBudgetMin} onBudgetMaxChange={f.setBudgetMax}
      totalCount={totalCount}
      filteredCount={filteredCount}
      onClearAll={f.clearAll}
    />
  );
}
