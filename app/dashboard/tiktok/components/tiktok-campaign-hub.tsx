'use client';

import { useMemo, useRef, useState } from 'react';
import { aggregateByCampaignId, aggregateAllRevByCampaignId } from '@/lib/adjust/csv-parser';
import { mergeTiktokCampaigns } from '@/lib/tiktok/merge';
import { filterTiktokCampaigns } from '@/lib/tiktok/filter-campaigns';
import { formatUsd } from '@/lib/utils';
import FilterBar from '@/app/dashboard/components/filter-bar';
import TiktokHeader from './tiktok-header';
import TiktokResultsPanel from './tiktok-results-panel';
import TiktokFetchPanel from './tiktok-fetch-panel';
import type { AdjustRow, MergedTiktokCampaign, TiktokAdvertiserAccount, TiktokCampaignRow, TiktokStaffMember, UserRole } from '@/lib/types';

type Phase = 'idle' | 'loading' | 'results' | 'error';

interface Props {
  hasTiktokConnection: boolean;
  hasAdjustToken: boolean;
  selectedAdvertisers: TiktokAdvertiserAccount[];
  userRole: UserRole;
  staffList: TiktokStaffMember[];
  userEmail: string;
}

export default function TiktokCampaignHub({ hasTiktokConnection, hasAdjustToken, selectedAdvertisers, userRole, staffList, userEmail }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [mergedCampaigns, setMergedCampaigns] = useState<MergedTiktokCampaign[]>([]);
  const [adjustRows, setAdjustRows] = useState<AdjustRow[]>([]);
  const [campaignNameFilter, setCampaignNameFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [accountFilter, setAccountFilter] = useState('');
  const [roasMin, setRoasMin] = useState(''); const [roasMax, setRoasMax] = useState('');
  const [spendMin, setSpendMin] = useState(''); const [spendMax, setSpendMax] = useState('');
  const [budgetMin, setBudgetMin] = useState(''); const [budgetMax, setBudgetMax] = useState('');
  const [sortCol, setSortCol] = useState('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const viewing = staffList.find((s) => s.id === viewingUserId) ?? null;
  const readOnly = !!viewing;
  const activeAdvertisers = viewing ? viewing.accounts : selectedAdvertisers;
  // Bumped per fetch/picker switch — stale responses are dropped so data never shows under the wrong user.
  const fetchSeq = useRef(0);

  function handleViewingChange(userId: string | null) {
    fetchSeq.current++;
    setViewingUserId(userId);
    setPhase('idle');
    setErrorMsg('');
    setMergedCampaigns([]);
    setAdjustRows([]);
    setSelectedIds(new Set());
    setCampaignNameFilter(''); setAccountFilter(''); setStatusFilter('all');
    setRoasMin(''); setRoasMax(''); setSpendMin(''); setSpendMax('');
    setBudgetMin(''); setBudgetMax('');
  }

  async function handleFetchData() {
    const seq = ++fetchSeq.current;
    setPhase('loading');
    setErrorMsg('');
    try {
      const campaignsUrl = new URL('/api/tiktok/campaigns', window.location.origin);
      if (viewingUserId) campaignsUrl.searchParams.set('viewAs', viewingUserId);
      const [campaignsRes, revenueRes] = await Promise.all([
        fetch(campaignsUrl),
        fetch('/api/adjust/revenue?partner=tiktok'),
      ]);
      const campaignsData = await campaignsRes.json();
      if (seq !== fetchSeq.current) return;
      if (!campaignsRes.ok) throw new Error(campaignsData.error ?? 'Failed to fetch TikTok campaigns');

      const revenueData = await revenueRes.json();
      if (seq !== fetchSeq.current) return;
      const rows: AdjustRow[] = revenueRes.ok ? (revenueData.rows ?? []) : [];
      setAdjustRows(rows);

      const cohortMap = aggregateByCampaignId(rows);
      const allRevMap = aggregateAllRevByCampaignId(rows);
      const merged = mergeTiktokCampaigns(campaignsData.campaigns as TiktokCampaignRow[], new Map(), cohortMap, allRevMap);
      setMergedCampaigns(merged);
      setSelectedIds(new Set());
      setPhase('results');
    } catch (err) {
      if (seq !== fetchSeq.current) return; // stale fetch
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
      <TiktokHeader
        userEmail={userEmail}
        userRole={userRole}
        staffList={staffList}
        viewingUserId={viewingUserId}
        onViewingChange={handleViewingChange}
      />

      <main className={phase === 'results' ? 'px-6 pt-4 pb-4 w-full flex flex-col gap-3' : 'max-w-screen-xl mx-auto w-full px-6 py-6 flex flex-col gap-5'}>
        <TiktokFetchPanel
          viewingEmail={viewing?.email ?? null}
          connected={viewing ? true : hasTiktokConnection}
          advertiserCount={activeAdvertisers.length}
          hasAdjustToken={hasAdjustToken}
          showFetchCard={phase !== 'results'}
          loading={phase === 'loading'}
          errorMsg={phase === 'error' ? errorMsg : ''}
          onFetch={handleFetchData}
        />

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

            <TiktokResultsPanel
              allCampaigns={mergedCampaigns}
              displayedCampaigns={displayedCampaigns}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              sortCol={sortCol}
              sortDir={sortDir}
              onSort={handleSort}
              showAdvertiserColumn={accountOptions.length > 1}
              adjustRows={adjustRows}
              onCampaignActionComplete={handleFetchData}
              viewAs={viewingUserId ?? undefined}
              readOnly={readOnly}
            />
          </div>
        )}
      </main>
    </div>
  );
}
