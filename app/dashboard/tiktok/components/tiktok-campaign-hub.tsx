'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { aggregateByCampaignId, aggregateAllRevByCampaignId } from '@/lib/adjust/csv-parser';
import { mergeTiktokCampaigns } from '@/lib/tiktok/merge';
import { filterTiktokCampaigns } from '@/lib/tiktok/filter-campaigns';
import { formatUsd } from '@/lib/utils';
import FilterBar from '@/app/dashboard/components/filter-bar';
import TiktokHeader from './tiktok-header';
import TiktokCampaignTable from './tiktok-campaign-table';
import type { AdjustRow, MergedTiktokCampaign, TiktokAdvertiserAccount, TiktokCampaignRow } from '@/lib/types';

type Phase = 'idle' | 'loading' | 'results' | 'error';

interface Props {
  hasTiktokConnection: boolean;
  hasAdjustToken: boolean;
  selectedAdvertisers: TiktokAdvertiserAccount[];
  userEmail: string;
}

export default function TiktokCampaignHub({ hasTiktokConnection, hasAdjustToken, selectedAdvertisers, userEmail }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [mergedCampaigns, setMergedCampaigns] = useState<MergedTiktokCampaign[]>([]);

  const [campaignNameFilter, setCampaignNameFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [accountFilter, setAccountFilter] = useState('');
  const [roasMin, setRoasMin] = useState(''); const [roasMax, setRoasMax] = useState('');
  const [spendMin, setSpendMin] = useState(''); const [spendMax, setSpendMax] = useState('');
  const [budgetMin, setBudgetMin] = useState(''); const [budgetMax, setBudgetMax] = useState('');
  const [sortCol, setSortCol] = useState('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const canFetch = hasTiktokConnection && selectedAdvertisers.length > 0;

  async function handleFetchData() {
    setPhase('loading');
    setErrorMsg('');
    try {
      const [campaignsRes, revenueRes] = await Promise.all([
        fetch('/api/tiktok/campaigns'),
        fetch('/api/adjust/revenue?partner=tiktok'),
      ]);
      const campaignsData = await campaignsRes.json();
      if (!campaignsRes.ok) throw new Error(campaignsData.error ?? 'Failed to fetch TikTok campaigns');

      const revenueData = await revenueRes.json();
      const adjustRows: AdjustRow[] = revenueRes.ok ? (revenueData.rows ?? []) : [];

      const cohortMap = aggregateByCampaignId(adjustRows);
      const allRevMap = aggregateAllRevByCampaignId(adjustRows);
      // Spend is already overlaid server-side (TiktokCampaignRow[]) — empty spendMap here is a no-op merge.
      const merged = mergeTiktokCampaigns(campaignsData.campaigns as TiktokCampaignRow[], new Map(), cohortMap, allRevMap);
      setMergedCampaigns(merged);
      setSelectedIds(new Set());
      setPhase('results');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to fetch TikTok data');
      setPhase('error');
    }
  }

  function handleSort(col: string) {
    if (col === sortCol) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('desc'); }
  }

  const accountOptions = useMemo<[string, string][]>(() => {
    const seen = new Map<string, string>();
    for (const c of mergedCampaigns) seen.set(c.advertiser_id, c.advertiser_name);
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [mergedCampaigns]);

  const displayedCampaigns = useMemo(() => {
    const filtered = filterTiktokCampaigns(mergedCampaigns, {
      campaignName: campaignNameFilter, statusFilter, accountFilter,
      roasMin, roasMax, spendMin, spendMax, budgetMin, budgetMax,
    });
    return [...filtered].sort((a, b) => {
      const av = (a[sortCol as keyof MergedTiktokCampaign] as number | null) ?? 0;
      const bv = (b[sortCol as keyof MergedTiktokCampaign] as number | null) ?? 0;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [mergedCampaigns, campaignNameFilter, statusFilter, accountFilter, roasMin, roasMax, spendMin, spendMax, budgetMin, budgetMax, sortCol, sortDir]);

  const totalSpend = mergedCampaigns.reduce((s, c) => s + c.spend, 0);

  return (
    <div className="flex flex-col bg-slate-50 min-h-screen">
      <TiktokHeader userEmail={userEmail} />

      <main className={phase === 'results' ? 'px-6 pt-4 pb-4 w-full flex flex-col gap-3' : 'max-w-screen-xl mx-auto w-full px-6 py-6 flex flex-col gap-5'}>
        {!hasTiktokConnection && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            TikTok is not connected.{' '}
            <Link href="/settings" className="font-medium underline">Go to Settings</Link> to connect (admin only).
          </div>
        )}
        {hasTiktokConnection && selectedAdvertisers.length === 0 && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            No TikTok advertiser accounts selected.{' '}
            <Link href="/settings" className="font-medium underline">Go to Settings</Link> to select accounts.
          </div>
        )}

        {phase !== 'results' && (
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 max-w-lg">
            {canFetch && (
              <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-700">
                Will fetch campaigns from <strong>{selectedAdvertisers.length}</strong> advertiser account{selectedAdvertisers.length !== 1 ? 's' : ''}.
                {!hasAdjustToken && ' Adjust revenue is not configured, so ROAS/Profit will be unavailable.'}
              </div>
            )}
            <button
              onClick={handleFetchData}
              disabled={!canFetch || phase === 'loading'}
              className="w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {phase === 'loading' ? 'Fetching…' : 'Fetch Data'}
            </button>
            {phase === 'error' && <p className="text-sm text-red-600">{errorMsg}</p>}
          </div>
        )}

        {phase === 'results' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4 p-3 bg-sky-50 border border-sky-200 rounded-lg text-xs text-sky-800">
              <span>TikTok spend typically lags 24–48h — today&apos;s figures ({formatUsd(totalSpend)} so far) may be incomplete.</span>
              <button onClick={() => setPhase('idle')} className="text-slate-500 hover:text-slate-700 font-medium whitespace-nowrap">Start Over</button>
            </div>

            {/* Reusing the FB FilterBar as-is: appOptions=[] fully hides the app multi-select (TikTok
                has no app-name dimension in Plan 1), and the keyword-chip handlers are no-ops since
                that feature isn't needed here — decided in phase-03 Step 6 rather than forking a
                tiktok-filter-bar.tsx. */}
            <FilterBar
              campaignName={campaignNameFilter}
              onCampaignNameChange={setCampaignNameFilter}
              campaignNameKeywords={[]}
              onAddKeyword={() => {}}
              onRemoveKeyword={() => {}}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              selectedApps={[]}
              onSelectedAppsChange={() => {}}
              appOptions={[]}
              accountFilter={accountFilter}
              onAccountFilterChange={setAccountFilter}
              accountOptions={accountOptions}
              roasMin={roasMin} roasMax={roasMax}
              onRoasMinChange={setRoasMin} onRoasMaxChange={setRoasMax}
              spendMin={spendMin} spendMax={spendMax}
              onSpendMinChange={setSpendMin} onSpendMaxChange={setSpendMax}
              budgetMin={budgetMin} budgetMax={budgetMax}
              onBudgetMinChange={setBudgetMin} onBudgetMaxChange={setBudgetMax}
              totalCount={mergedCampaigns.length}
              filteredCount={displayedCampaigns.length}
              onClearAll={() => {
                setCampaignNameFilter(''); setAccountFilter('');
                setRoasMin(''); setRoasMax(''); setSpendMin(''); setSpendMax('');
                setBudgetMin(''); setBudgetMax(''); setStatusFilter('all');
              }}
            />

            <div className="h-[calc(100vh-300px)] min-h-[420px] overflow-hidden pb-3">
              <TiktokCampaignTable
                campaigns={displayedCampaigns}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                sortCol={sortCol}
                sortDir={sortDir}
                onSort={handleSort}
                showAdvertiserColumn={accountOptions.length > 1}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
