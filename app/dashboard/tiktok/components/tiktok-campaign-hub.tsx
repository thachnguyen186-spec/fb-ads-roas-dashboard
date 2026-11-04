'use client';

import { useMemo, useRef, useState } from 'react';
import { aggregateByCampaignId, aggregateAllRevByCampaignId, aggregateAppByCampaignId } from '@/lib/adjust/csv-parser';
import { mergeTiktokCampaigns } from '@/lib/tiktok/merge';
import { filterTiktokCampaigns } from '@/lib/tiktok/filter-campaigns';
import { tiktokSortValue } from '@/lib/tiktok/snapshot-helpers';
import { formatUsd } from '@/lib/utils';
import TiktokHeader from './tiktok-header';
import TiktokResultsPanel from './tiktok-results-panel';
import TiktokFetchPanel from './tiktok-fetch-panel';
import TiktokFilterSection from './tiktok-filter-section';
import TiktokSnapshotSection from './tiktok-snapshot-section';
import { useTiktokFilterState } from './use-tiktok-filter-state';
import { useTiktokSnapshots } from './use-tiktok-snapshots';
import { useTiktokAppsflyerRevenue } from './use-tiktok-appsflyer-revenue';
import type { AppsflyerParseResult } from '@/lib/appsflyer/appsflyer-csv-parser';
import type { AdjustRow, TiktokAdvertiserAccount, TiktokCampaignRow, TiktokStaffMember, UserRole } from '@/lib/types';

type Phase = 'idle' | 'loading' | 'results' | 'error';

const NO_ROWS: AdjustRow[] = [];

interface Props {
  hasTiktokConnection: boolean;
  selectedAdvertisers: TiktokAdvertiserAccount[];
  userRole: UserRole;
  staffList: TiktokStaffMember[];
  userEmail: string;
}

export default function TiktokCampaignHub({ hasTiktokConnection, selectedAdvertisers, userRole, staffList, userEmail }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [campaignRows, setCampaignRows] = useState<TiktokCampaignRow[]>([]);
  const af = useTiktokAppsflyerRevenue();
  // AppsFlyer-derived revenue rows (AdjustRow shape) — campaign_id + adset_id (= TikTok ad group id).
  const revenueRows = af.match?.rows ?? NO_ROWS;
  const mergedCampaigns = useMemo(
    () => mergeTiktokCampaigns(campaignRows, new Map(), aggregateByCampaignId(revenueRows), aggregateAllRevByCampaignId(revenueRows)),
    [campaignRows, revenueRows],
  );
  const appByCampaignId = useMemo(() => aggregateAppByCampaignId(revenueRows), [revenueRows]);
  const f = useTiktokFilterState();
  const [sortCol, setSortCol] = useState('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const snap = useTiktokSnapshots(mergedCampaigns);

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
    setCampaignRows([]);
    af.clearMatch(); // the uploaded file stays — it is org-wide, not per viewed user
    setSelectedIds(new Set());
    f.clearAll();
    snap.reset();
  }

  /** New file (or cleared file): re-map onto the campaigns already loaded — no campaign refetch. */
  function handleAppsflyerReady(result: AppsflyerParseResult | null) {
    af.setFile(result);
    void af.apply(campaignRows, viewingUserId);
  }

  async function handleFetchData() {
    const seq = ++fetchSeq.current;
    setPhase('loading');
    setErrorMsg('');
    try {
      const campaignsUrl = new URL('/api/tiktok/campaigns', window.location.origin);
      if (viewingUserId) campaignsUrl.searchParams.set('viewAs', viewingUserId);
      const campaignsRes = await fetch(campaignsUrl);
      const campaignsData = await campaignsRes.json();
      if (seq !== fetchSeq.current) return;
      if (!campaignsRes.ok) throw new Error(campaignsData.error ?? 'Failed to fetch TikTok campaigns');

      const rows = (campaignsData.campaigns ?? []) as TiktokCampaignRow[];
      setCampaignRows(rows);
      // Campaigns render immediately; AppsFlyer revenue (if a file is uploaded) is mapped in the background.
      void af.apply(rows, viewingUserId);
      setSelectedIds(new Set());
      setPhase('results');
      if (!viewingUserId) snap.load();
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

  // App names come from the AppsFlyer rows (TikTok API has no app dimension), same source as the FB hub.
  const appOptions = useMemo(
    () => Array.from(new Set(appByCampaignId.values())).sort((a, b) => a.localeCompare(b)),
    [appByCampaignId],
  );

  const snapshotComparisons = useMemo(() => (readOnly ? [] : snap.comparisons), [readOnly, snap.comparisons]);

  const displayedCampaigns = useMemo(() => {
    const filtered = filterTiktokCampaigns(mergedCampaigns, f.filters, appByCampaignId);
    return [...filtered].sort((a, b) => {
      const av = tiktokSortValue(a, sortCol, snapshotComparisons);
      const bv = tiktokSortValue(b, sortCol, snapshotComparisons);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [mergedCampaigns, f.filters, appByCampaignId, sortCol, sortDir, snapshotComparisons]);

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
          showFetchCard={phase !== 'results'}
          loading={phase === 'loading'}
          errorMsg={phase === 'error' ? errorMsg : ''}
          onFetch={handleFetchData}
          appsflyer={af}
          hasCampaigns={campaignRows.length > 0}
          onAppsflyerReady={handleAppsflyerReady}
        />

        {phase === 'results' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4 p-3 bg-sky-50 border border-sky-200 rounded-lg text-xs text-sky-800">
              <span>TikTok spend typically lags 24–48h — today&apos;s figures ({formatUsd(totalSpend)} so far) may be incomplete.</span>
              <button onClick={() => setPhase('idle')} className="text-slate-500 hover:text-slate-700 font-medium whitespace-nowrap">Start Over</button>
            </div>

            {/* Snapshots are per-user (RLS) — hidden while viewing another user so their data is never compared against/saved as mine. */}
            {!readOnly && <TiktokSnapshotSection snap={snap} revenueMissing={af.revenueMissing} />}

            <TiktokFilterSection
              state={f}
              appOptions={appOptions}
              accountOptions={accountOptions}
              totalCount={mergedCampaigns.length}
              filteredCount={displayedCampaigns.length}
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
              adjustRows={revenueRows}
              onCampaignActionComplete={handleFetchData}
              viewAs={viewingUserId ?? undefined}
              readOnly={readOnly}
              snapshotComparisons={snapshotComparisons}
            />
          </div>
        )}
      </main>
    </div>
  );
}
