/**
 * Toggles between the campaign table and the ad-group flat view (mirrors FB hub's
 * showAdsetOnly), and renders the matching selection action bar for whichever entity is
 * active. Ad groups are lazy-loaded on first toggle (not fetched eagerly with campaigns) to
 * avoid an extra advertiser fan-out when the user never opens this view (Phase 1 rate-limit
 * concern). Ad-group visibility is scoped to campaigns that pass the CURRENT filters — same
 * "filter applies at campaign level" rule FB's adset-flat-view already follows.
 */

'use client';

import { useMemo, useState } from 'react';
import { aggregateByAdSetId, aggregateAllRevByAdSetId } from '@/lib/adjust/csv-parser';
import { mergeTiktokAdGroups } from '@/lib/tiktok/merge';
import { MIN_DAILY_BUDGET_CAMPAIGN, MIN_DAILY_BUDGET_ADGROUP } from '@/lib/tiktok/budget-limits';
import TiktokCampaignTable from './tiktok-campaign-table';
import TiktokAdgroupFlatView from './tiktok-adgroup-flat-view';
import TiktokActionBar, { type TiktokActionItem } from './tiktok-action-bar';
import type { AdjustRow, FlatTiktokAdGroup, MergedTiktokAdGroup, MergedTiktokCampaign, TiktokAdGroupRow } from '@/lib/types';

interface Props {
  /** Unfiltered — used only to resolve campaign_name for ad groups. */
  allCampaigns: MergedTiktokCampaign[];
  displayedCampaigns: MergedTiktokCampaign[];
  sortCol: string;
  sortDir: 'asc' | 'desc';
  onSort: (col: string) => void;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  showAdvertiserColumn: boolean;
  adjustRows: AdjustRow[];
  onCampaignActionComplete: () => void;
}

export default function TiktokResultsPanel({
  allCampaigns, displayedCampaigns, sortCol, sortDir, onSort, selectedIds, onSelectionChange,
  showAdvertiserColumn, adjustRows, onCampaignActionComplete,
}: Props) {
  const [showAdgroupOnly, setShowAdgroupOnly] = useState(false);
  const [rawAdgroups, setRawAdgroups] = useState<MergedTiktokAdGroup[]>([]);
  const [loadingAdgroups, setLoadingAdgroups] = useState(false);
  const [adgroupError, setAdgroupError] = useState('');
  const [selectedAdgroupIds, setSelectedAdgroupIds] = useState<Set<string>>(new Set());

  async function loadAdgroups() {
    setLoadingAdgroups(true);
    setAdgroupError('');
    try {
      const res = await fetch('/api/tiktok/campaigns?level=adgroup');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to fetch TikTok ad groups');
      const cohortMap = aggregateByAdSetId(adjustRows);
      const allRevMap = aggregateAllRevByAdSetId(adjustRows);
      setRawAdgroups(mergeTiktokAdGroups(data.adgroups as TiktokAdGroupRow[], new Map(), cohortMap, allRevMap));
      setSelectedAdgroupIds(new Set());
    } catch (err) {
      setAdgroupError(err instanceof Error ? err.message : 'Failed to fetch TikTok ad groups');
    } finally {
      setLoadingAdgroups(false);
    }
  }

  function toggleAdgroupView() {
    const next = !showAdgroupOnly;
    setShowAdgroupOnly(next);
    if (next && rawAdgroups.length === 0) loadAdgroups();
  }

  const campaignNameById = useMemo(
    () => new Map(allCampaigns.map((c) => [c.campaign_id, c.campaign_name])),
    [allCampaigns],
  );
  const displayedCampaignIds = useMemo(() => new Set(displayedCampaigns.map((c) => c.campaign_id)), [displayedCampaigns]);
  const displayedAdgroups = useMemo<FlatTiktokAdGroup[]>(
    () => rawAdgroups
      .filter((a) => displayedCampaignIds.has(a.campaign_id))
      .map((a) => ({ ...a, campaign_name: campaignNameById.get(a.campaign_id) ?? a.campaign_id })),
    [rawAdgroups, displayedCampaignIds, campaignNameById],
  );

  const selectedCampaignItems: TiktokActionItem[] = useMemo(
    () => displayedCampaigns.filter((c) => selectedIds.has(c.campaign_id)).map((c) => ({
      id: c.campaign_id, name: c.campaign_name, status: c.status, budget: c.budget,
      budget_mode: c.budget_mode, advertiser_id: c.advertiser_id, currency: c.currency,
    })),
    [displayedCampaigns, selectedIds],
  );
  const selectedAdgroupItems: TiktokActionItem[] = useMemo(
    () => displayedAdgroups.filter((a) => selectedAdgroupIds.has(a.adgroup_id)).map((a) => ({
      id: a.adgroup_id, name: a.adgroup_name, status: a.status, budget: a.budget,
      budget_mode: a.budget_mode, advertiser_id: a.advertiser_id, currency: a.currency,
    })),
    [displayedAdgroups, selectedAdgroupIds],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          onClick={toggleAdgroupView}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${showAdgroupOnly ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
        >
          {showAdgroupOnly ? '← Show Campaigns' : 'Show Ad Groups Only'}
        </button>
        {adgroupError && <span className="text-xs text-red-600">{adgroupError}</span>}
      </div>

      <div className="h-[calc(100vh-340px)] min-h-[420px] overflow-hidden pb-3">
        {!showAdgroupOnly && (
          <TiktokCampaignTable
            campaigns={displayedCampaigns}
            selectedIds={selectedIds}
            onSelectionChange={onSelectionChange}
            sortCol={sortCol}
            sortDir={sortDir}
            onSort={onSort}
            showAdvertiserColumn={showAdvertiserColumn}
          />
        )}
        {showAdgroupOnly && (
          loadingAdgroups ? (
            <div className="h-full flex items-center justify-center bg-white border border-slate-200 rounded-xl text-sm text-slate-400">
              Loading ad groups…
            </div>
          ) : (
            <TiktokAdgroupFlatView
              adgroups={displayedAdgroups}
              selectedIds={selectedAdgroupIds}
              onSelectionChange={setSelectedAdgroupIds}
              showAdvertiserColumn={showAdvertiserColumn}
              minDailyBudget={MIN_DAILY_BUDGET_ADGROUP}
              onBudgetUpdated={loadAdgroups}
            />
          )
        )}
      </div>

      {!showAdgroupOnly && selectedCampaignItems.length > 0 && (
        <TiktokActionBar
          entityType="campaign"
          items={selectedCampaignItems}
          minDailyBudget={MIN_DAILY_BUDGET_CAMPAIGN}
          onActionComplete={onCampaignActionComplete}
          onDeselect={() => onSelectionChange(new Set())}
        />
      )}
      {showAdgroupOnly && selectedAdgroupItems.length > 0 && (
        <TiktokActionBar
          entityType="adgroup"
          items={selectedAdgroupItems}
          minDailyBudget={MIN_DAILY_BUDGET_ADGROUP}
          onActionComplete={loadAdgroups}
          onDeselect={() => setSelectedAdgroupIds(new Set())}
        />
      )}
    </div>
  );
}
