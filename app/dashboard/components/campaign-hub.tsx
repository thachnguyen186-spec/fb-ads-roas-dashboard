'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { parseAdjustCsv, aggregateByCampaignId, aggregateByAdSetId, aggregateAppByCampaignId } from '@/lib/adjust/csv-parser';
import { mergeCampaigns, mergeAdSets } from '@/lib/adjust/merge';
import type { AdSetRow, CampaignRow, FbAdAccount, MergedCampaign, SnapshotAdSetRow, SnapshotData, SnapshotMeta, SnapshotRow, StaffMember, UserRole } from '@/lib/types';
import AdjustCsvUpload from './adjust-csv-upload';
import CampaignTable from './campaign-table';
import FilterBar from './filter-bar';
import ActionBar from './action-bar';
import AdsetFlatView, { type FlatAdSet } from './adset-flat-view';
import AdsetBulkBudgetModal from './adset-bulk-budget-modal';
import SnapshotToolbar from './snapshot-toolbar';

type Phase = 'idle' | 'csv_ready' | 'analyzing' | 'results' | 'error';

interface Props {
  hasToken: boolean;
  selectedAccounts: FbAdAccount[];
  userRole: UserRole;
  staffList: StaffMember[];
}

export default function CampaignHub({ hasToken, selectedAccounts, userRole, staffList }: Props) {
  const router = useRouter();

  // Leader/admin: which staff member to view (null = own data)
  const [viewingStaffId, setViewingStaffId] = useState<string | null>(null);
  const viewingStaff = staffList.find((s) => s.id === viewingStaffId) ?? null;

  const [phase, setPhase] = useState<Phase>('idle');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [appFilter, setAppFilter] = useState<string | undefined>(undefined);
  const [rawFbCampaigns, setRawFbCampaigns] = useState<CampaignRow[]>([]);
  const [adjustMapState, setAdjustMapState] = useState<Map<string, number>>(new Map());
  const [adjustAdSetMapState, setAdjustAdSetMapState] = useState<Map<string, number>>(new Map());
  const [adjustAppMapState, setAdjustAppMapState] = useState<Map<string, string>>(new Map());
  // Adset-only flat view
  const [showAdsetOnly, setShowAdsetOnly] = useState(false);
  const [rawFlatAdSets, setRawFlatAdSets] = useState<Array<AdSetRow & { campaign_name: string }>>([]);
  const [loadingAllAdsets, setLoadingAllAdsets] = useState(false);
  const [selectedFlatAdsetIds, setSelectedFlatAdsetIds] = useState<Set<string>>(new Set());
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [mergedCampaigns, setMergedCampaigns] = useState<MergedCampaign[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [roasMin, setRoasMin] = useState('');
  const [roasMax, setRoasMax] = useState('');
  const [accountFilter, setAccountFilter] = useState(''); // '' = all accounts
  const [appNameFilter, setAppNameFilter] = useState('');
  const [campaignNameFilter, setCampaignNameFilter] = useState('');
  const [spendMin, setSpendMin] = useState('');
  const [spendMax, setSpendMax] = useState('');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [sortCol, setSortCol] = useState<keyof MergedCampaign>('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [vndRate, setVndRate] = useState(26000);
  const [rateInput, setRateInput] = useState('26000');
  // Snapshots
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [activeSnapshot, setActiveSnapshot] = useState<SnapshotData | null>(null);
  const [savingSnapshot, setSavingSnapshot] = useState(false);

  // Auto-select zoom based on available viewport height so small monitors show as many rows as large ones
  const [zoom, setZoom] = useState<number>(() => {
    if (typeof window === 'undefined') return 100;
    const h = window.innerHeight;
    if (h >= 900) return 100;
    if (h >= 768) return 90;
    return 80;
  });

  // Determine if the current view has FB credentials configured
  const viewingAccounts = viewingStaff ? viewingStaff.accounts : selectedAccounts;
  const hasFbConfig = hasToken && viewingAccounts.length > 0;

  // Whether any loaded campaign is in VND
  const hasVndAccounts = useMemo(
    () => rawFbCampaigns.some((c) => c.currency === 'VND'),
    [rawFbCampaigns],
  );

  function handleStartOver() {
    setPhase('idle');
    setCsvFile(null);
    setRawFbCampaigns([]);
    setAdjustMapState(new Map());
    setAdjustAdSetMapState(new Map());
    setAdjustAppMapState(new Map());
    setShowAdsetOnly(false);
    setRawFlatAdSets([]);
    setSelectedFlatAdsetIds(new Set());
    setMergedCampaigns([]);
    setSelectedIds(new Set());
    setAccountFilter('');
    setAppNameFilter('');
    setCampaignNameFilter('');
    setSpendMin(''); setSpendMax('');
    setBudgetMin(''); setBudgetMax('');
    setRoasMin(''); setRoasMax('');
    setSnapshots([]);
    setSelectedSnapshotId(null);
    setActiveSnapshot(null);
  }

  async function fetchSnapshots() {
    const res = await fetch('/api/snapshots');
    if (res.ok) {
      const data = await res.json();
      setSnapshots(data.snapshots ?? []);
    }
  }

  async function handleSelectSnapshot(id: string | null) {
    setSelectedSnapshotId(id);
    if (!id) { setActiveSnapshot(null); return; }
    const res = await fetch(`/api/snapshots/${id}`);
    if (res.ok) {
      const data = await res.json();
      setActiveSnapshot(data.snapshot_data as SnapshotData);
    }
  }

  async function handleSaveSnapshot(name: string) {
    setSavingSnapshot(true);
    try {
      // Collect current campaign metrics
      const campaigns: SnapshotRow[] = mergedCampaigns.map((c) => ({
        campaign_id: c.campaign_id,
        campaign_name: c.campaign_name,
        roas: c.roas,
        profit_pct: c.profit_pct,
      }));
      // Fetch and merge all adsets in parallel
      const adsetResults = await Promise.all(
        mergedCampaigns.map(async (c) => {
          const url = `/api/campaigns/${c.campaign_id}/adsets?accountId=${encodeURIComponent(c.account_id)}&accountName=${encodeURIComponent(c.account_name)}&currency=${encodeURIComponent(c.currency)}`;
          const res = await fetch(url);
          const data = await res.json();
          if (!res.ok) return [] as SnapshotAdSetRow[];
          return mergeAdSets(data.adsets as AdSetRow[], adjustAdSetMapState, vndRate).map((a): SnapshotAdSetRow => ({
            adset_id: a.adset_id,
            campaign_id: c.campaign_id,
            adset_name: a.adset_name,
            roas: a.roas,
            profit_pct: a.profit_pct,
          }));
        }),
      );
      const adsets = adsetResults.flat();
      const snapshot_data: SnapshotData = { campaigns, adsets };
      await fetch('/api/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, snapshot_data }),
      });
      await fetchSnapshots();
    } finally {
      setSavingSnapshot(false);
    }
  }

  async function handleDeleteSnapshot(id: string) {
    await fetch(`/api/snapshots/${id}`, { method: 'DELETE' });
    if (selectedSnapshotId === id) {
      setSelectedSnapshotId(null);
      setActiveSnapshot(null);
    }
    await fetchSnapshots();
  }

  function handleRecalculate() {
    const rate = parseFloat(rateInput);
    if (isNaN(rate) || rate <= 0) return;
    setVndRate(rate);
    setMergedCampaigns(mergeCampaigns(rawFbCampaigns, adjustMapState, rate));
  }

  async function loadAllAdsets(campaigns: MergedCampaign[]) {
    setLoadingAllAdsets(true);
    setRawFlatAdSets([]);
    setSelectedFlatAdsetIds(new Set());
    try {
      const results = await Promise.all(
        campaigns.map(async (c) => {
          const url = `/api/campaigns/${c.campaign_id}/adsets?accountId=${encodeURIComponent(c.account_id)}&accountName=${encodeURIComponent(c.account_name)}&currency=${encodeURIComponent(c.currency)}`;
          const res = await fetch(url);
          const data = await res.json();
          if (!res.ok) return [];
          return (data.adsets as AdSetRow[]).map((a) => ({ ...a, campaign_name: c.campaign_name }));
        }),
      );
      setRawFlatAdSets(results.flat());
    } finally {
      setLoadingAllAdsets(false);
    }
  }

  function switchToStaff(staffId: string | null) {
    setViewingStaffId(staffId);
    handleStartOver();
  }

  function handleCsvReady(file: File, filter: string | undefined) {
    setCsvFile(file);
    setAppFilter(filter);
    setPhase('csv_ready');
  }

  async function handleAnalyze() {
    if (!csvFile) return;
    setPhase('analyzing');
    setErrorMsg('');
    setSelectedIds(new Set());
    setAccountFilter('');

    try {
      const url = new URL('/api/campaigns', window.location.origin);
      if (viewingStaffId) url.searchParams.set('viewAs', viewingStaffId);

      const [fbRes, adjustRows] = await Promise.all([
        fetch(url.toString()).then((r) => r.json()),
        parseAdjustCsv(csvFile, appFilter),
      ]);

      if (fbRes.error) throw new Error(fbRes.error);
      const adjustMap = aggregateByCampaignId(adjustRows);
      const adjustAdSetMap = aggregateByAdSetId(adjustRows);
      const adjustAppMap = aggregateAppByCampaignId(adjustRows);
      const fbCampaigns = fbRes.campaigns as CampaignRow[];
      setRawFbCampaigns(fbCampaigns);
      setAdjustMapState(adjustMap);
      setAdjustAdSetMapState(adjustAdSetMap);
      setAdjustAppMapState(adjustAppMap);
      const merged = mergeCampaigns(fbCampaigns, adjustMap, vndRate);
      setMergedCampaigns(merged);
      setPhase('results');
      fetchSnapshots(); // load saved snapshots when results are ready
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
      setPhase('error');
    }
  }

  function handleSort(col: keyof MergedCampaign) {
    if (col === sortCol) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('desc'); }
  }

  // Unique account names found in loaded campaigns (for filter dropdown)
  const accountOptions = useMemo(() => {
    const seen = new Map<string, string>(); // account_id → account_name
    for (const c of mergedCampaigns) seen.set(c.account_id, c.account_name);
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [mergedCampaigns]);

  // Unique app names from Adjust CSV (more reliable than FB app_name which is null for non-app campaigns)
  const appOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const appName of adjustAppMapState.values()) {
      if (appName) seen.add(appName);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [adjustAppMapState]);

  // Flat adset view: re-merge raw adsets whenever vndRate or adjustAdSetMap changes
  const flatAdsets: FlatAdSet[] = useMemo(() => {
    if (rawFlatAdSets.length === 0) return [];
    return rawFlatAdSets.map((raw) => {
      const merged = mergeAdSets([raw], adjustAdSetMapState, vndRate)[0]!;
      return { ...merged, campaign_name: raw.campaign_name };
    });
  }, [rawFlatAdSets, adjustAdSetMapState, vndRate]);

  const selectedFlatAdsets = useMemo(
    () => flatAdsets.filter((a) => selectedFlatAdsetIds.has(a.adset_id)),
    [flatAdsets, selectedFlatAdsetIds],
  );

  const displayedCampaigns = useMemo(() => {
    let list = [...mergedCampaigns];
    if (campaignNameFilter) {
      const q = campaignNameFilter.toLowerCase();
      list = list.filter((c) => c.campaign_name.toLowerCase().includes(q));
    }
    if (accountFilter) list = list.filter((c) => c.account_id === accountFilter);
    if (appNameFilter) list = list.filter((c) => adjustAppMapState.get(c.campaign_id) === appNameFilter);
    const roasMinN = roasMin !== '' ? parseFloat(roasMin) : null;
    const roasMaxN = roasMax !== '' ? parseFloat(roasMax) : null;
    if (roasMinN !== null) list = list.filter((c) => c.roas !== null && c.roas >= roasMinN);
    if (roasMaxN !== null) list = list.filter((c) => c.roas !== null && c.roas <= roasMaxN);
    const spendMinN = spendMin !== '' ? parseFloat(spendMin) : null;
    const spendMaxN = spendMax !== '' ? parseFloat(spendMax) : null;
    if (spendMinN !== null) list = list.filter((c) => c.spend >= spendMinN);
    if (spendMaxN !== null) list = list.filter((c) => c.spend <= spendMaxN);
    const budgetMinN = budgetMin !== '' ? parseFloat(budgetMin) : null;
    const budgetMaxN = budgetMax !== '' ? parseFloat(budgetMax) : null;
    if (budgetMinN !== null) list = list.filter((c) => {
      const b = c.daily_budget ?? c.lifetime_budget ?? 0;
      return b >= budgetMinN;
    });
    if (budgetMaxN !== null) list = list.filter((c) => {
      const b = c.daily_budget ?? c.lifetime_budget ?? 0;
      return b <= budgetMaxN;
    });
    list.sort((a, b) => {
      const av = (a[sortCol] ?? 0) as number;
      const bv = (b[sortCol] ?? 0) as number;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return list;
  }, [mergedCampaigns, adjustAppMapState, campaignNameFilter, accountFilter, appNameFilter, roasMin, roasMax, spendMin, spendMax, budgetMin, budgetMax, sortCol, sortDir]);

  const selectedCampaigns = useMemo(
    () => displayedCampaigns.filter((c) => selectedIds.has(c.campaign_id)),
    [displayedCampaigns, selectedIds],
  );

  // Derive snapshot lookup maps — null when no snapshot is selected
  const snapshotCampaignMap = useMemo<Map<string, SnapshotRow> | null>(() => {
    if (!activeSnapshot) return null;
    return new Map(activeSnapshot.campaigns.map((r) => [r.campaign_id, r]));
  }, [activeSnapshot]);

  const snapshotAdSetMap = useMemo<Map<string, SnapshotAdSetRow> | null>(() => {
    if (!activeSnapshot) return null;
    return new Map(activeSnapshot.adsets.map((r) => [r.adset_id, r]));
  }, [activeSnapshot]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const isResults = phase === 'results';

  return (
    // Outer: no zoom, fixed-height in results so table scroll is contained inside the page
    <div className={`flex flex-col bg-slate-50 ${isResults ? 'h-screen overflow-hidden' : 'min-h-screen'}`}>
    {/* Inner: zoomed. Height compensated so zoom never shrinks below viewport (e.g. zoom=80 → height=125%) */}
    <div
      style={{
        zoom: zoom / 100,
        height: isResults ? `${(10000 / zoom).toFixed(2)}%` : undefined,
        minHeight: !isResults ? '100%' : undefined,
      }}
      className="flex flex-col"
    >
      <header className="flex-shrink-0 bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-slate-900">FB Ads ROAS</h1>
          {/* Leader/admin: staff switcher */}
          {(userRole === 'leader' || userRole === 'admin') && staffList.length > 0 && (
            <select
              value={viewingStaffId ?? ''}
              onChange={(e) => switchToStaff(e.target.value || null)}
              className="text-xs border border-slate-300 rounded-lg px-2 py-1 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">My dashboard</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>{s.email}</option>
              ))}
            </select>
          )}
          {viewingStaff && (
            <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">
              Viewing: {viewingStaff.email}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {/* Zoom control */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-400">Zoom</span>
            <select
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="text-xs border border-slate-300 rounded px-1.5 py-0.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value={100}>100%</option>
              <option value={90}>90%</option>
              <option value={80}>80%</option>
              <option value={75}>75%</option>
              <option value={70}>70%</option>
            </select>
          </div>
          {userRole === 'admin' && (
            <Link href="/admin" className="text-sm text-purple-600 hover:text-purple-700 font-medium">Admin</Link>
          )}
          <Link href="/settings" className="text-sm text-slate-500 hover:text-slate-800">Settings</Link>
          <button onClick={handleSignOut} className="text-sm text-slate-500 hover:text-slate-800">Sign out</button>
        </div>
      </header>

      <main className={isResults ? 'flex-1 min-h-0 overflow-hidden flex flex-col gap-3 px-6 pt-4 pb-0 w-full' : 'max-w-screen-xl mx-auto w-full px-6 py-6 flex flex-col gap-5'}>

        {!hasToken && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            Facebook access token not configured.{' '}
            <Link href="/settings" className="font-medium underline">Go to Settings</Link> to add it.
          </div>
        )}

        {hasToken && viewingAccounts.length === 0 && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            No ad accounts selected.{' '}
            <Link href="/settings" className="font-medium underline">Go to Settings</Link>{' '}
            to fetch and select your ad accounts.
          </div>
        )}

        {/* Step card */}
        {phase !== 'results' && (
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5 max-w-lg">

            {/* Account summary (informational, not a selector) */}
            {hasFbConfig && (
              <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-700">
                Will fetch active campaigns from <strong>{viewingAccounts.length}</strong> ad account{viewingAccounts.length !== 1 ? 's' : ''}:&nbsp;
                {viewingAccounts.map((a) => a.name).join(', ')}
              </div>
            )}

            {/* Step 1: Upload Adjust CSV */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-semibold">1</span>
                <h2 className="font-medium text-slate-900">Upload Adjust CSV</h2>
              </div>
              <p className="text-xs text-slate-500">Export from Adjust → Analytics → Campaign report</p>
              <AdjustCsvUpload onReady={handleCsvReady} disabled={!hasFbConfig} />
            </div>

            {phase === 'csv_ready' && (
              <>
                <hr className="border-slate-200" />
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-semibold">2</span>
                    <h2 className="font-medium text-slate-900">Fetch &amp; Analyze</h2>
                  </div>
                  <button
                    onClick={handleAnalyze}
                    className="w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                  >
                    Fetch all active campaigns &amp; match with CSV
                  </button>
                </div>
              </>
            )}

            {phase === 'analyzing' && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <svg className="animate-spin w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Fetching active campaigns from {viewingAccounts.length} account{viewingAccounts.length !== 1 ? 's' : ''}…
              </div>
            )}

            {phase === 'error' && (
              <div className="space-y-2">
                <p className="text-sm text-red-600">{errorMsg}</p>
                <button onClick={() => setPhase('csv_ready')} className="text-xs text-indigo-600 hover:underline">Try again</button>
              </div>
            )}
          </div>
        )}

        {/* Results */}
        {phase === 'results' && (
          <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
            {/* Controls — fixed height, never scroll */}
            <div className="flex-shrink-0 flex flex-col gap-3">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 flex items-center justify-between">
                <span>⚠ Today&apos;s FB spend may be incomplete — insights delayed 6–48h. Active campaigns only.</span>
                <button onClick={handleStartOver} className="ml-4 text-amber-800 underline hover:no-underline whitespace-nowrap">Start over</button>
              </div>

              {/* VND/USD rate control — only shown when VND accounts are present */}
              {hasVndAccounts && (
                <div className="flex items-center gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm">
                  <span className="text-orange-800 font-medium whitespace-nowrap">VND → USD rate:</span>
                  <input
                    type="number"
                    value={rateInput}
                    onChange={(e) => setRateInput(e.target.value)}
                    min="1"
                    className="w-28 px-2 py-1 border border-slate-300 rounded text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
                    placeholder="26000"
                  />
                  <button
                    onClick={handleRecalculate}
                    className="px-3 py-1 bg-orange-500 text-white text-sm font-medium rounded hover:bg-orange-600 transition-colors whitespace-nowrap"
                  >
                    Recalculate
                  </button>
                  <span className="text-xs text-orange-600">Current: 1 USD = {vndRate.toLocaleString()} VND</span>
                </div>
              )}

              {/* View toggle: campaigns vs flat adsets */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const next = !showAdsetOnly;
                    setShowAdsetOnly(next);
                    if (next) loadAllAdsets(displayedCampaigns);
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${showAdsetOnly ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                >
                  {showAdsetOnly ? '← Show Campaigns' : 'Show Ad Sets Only'}
                </button>
                {showAdsetOnly && selectedFlatAdsets.length > 0 && (
                  <button
                    onClick={() => setShowBulkModal(true)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 transition-colors"
                  >
                    Change Budget ({selectedFlatAdsets.length} ad set{selectedFlatAdsets.length !== 1 ? 's' : ''})
                  </button>
                )}
              </div>

              {/* Snapshot save + compare selector */}
              <SnapshotToolbar
                snapshots={snapshots}
                selectedId={selectedSnapshotId}
                onSelect={handleSelectSnapshot}
                onSave={handleSaveSnapshot}
                onDelete={handleDeleteSnapshot}
                saving={savingSnapshot}
              />

              {/* Unified filter bar — shown in campaign view only */}
              {!showAdsetOnly && (
                <FilterBar
                  campaignName={campaignNameFilter}
                  onCampaignNameChange={setCampaignNameFilter}
                  appFilter={appNameFilter}
                  onAppFilterChange={setAppNameFilter}
                  appOptions={appOptions}
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
                    setCampaignNameFilter(''); setAppNameFilter(''); setAccountFilter('');
                    setRoasMin(''); setRoasMax('');
                    setSpendMin(''); setSpendMax('');
                    setBudgetMin(''); setBudgetMax('');
                  }}
                />
              )}
            </div>

            {/* Table area — fills remaining vertical space, both axes scroll within */}
            <div className="flex-1 min-h-0 overflow-hidden pb-3">
              {/* Campaign table */}
              {!showAdsetOnly && (
                <CampaignTable
                  campaigns={displayedCampaigns}
                  selectedIds={selectedIds}
                  onSelectionChange={setSelectedIds}
                  sortCol={sortCol}
                  sortDir={sortDir}
                  onSort={handleSort}
                  showAccountColumn={accountOptions.length > 1}
                  adjustAdSetMap={adjustAdSetMapState}
                  vndRate={vndRate}
                  snapshotCampaignMap={snapshotCampaignMap}
                  snapshotAdSetMap={snapshotAdSetMap}
                />
              )}

              {/* Flat adset view */}
              {showAdsetOnly && (
                loadingAllAdsets ? (
                  <div className="h-full flex items-center justify-center bg-white border border-slate-200 rounded-xl text-sm text-slate-400">
                    Loading ad sets from {displayedCampaigns.length} campaign{displayedCampaigns.length !== 1 ? 's' : ''}…
                  </div>
                ) : (
                  <AdsetFlatView
                    adsets={flatAdsets}
                    selectedIds={selectedFlatAdsetIds}
                    onSelectionChange={setSelectedFlatAdsetIds}
                    vndRate={vndRate}
                    showAccountColumn={accountOptions.length > 1}
                    snapshotAdSetMap={snapshotAdSetMap}
                  />
                )
              )}
            </div>
          </div>
        )}
      </main>

      {phase === 'results' && selectedCampaigns.length > 0 && !showAdsetOnly && (
        <ActionBar
          selectedCampaigns={selectedCampaigns}
          onActionComplete={() => { if (csvFile) { setPhase('analyzing'); handleAnalyze(); } }}
          onDeselect={() => setSelectedIds(new Set())}
          vndRate={vndRate}
        />
      )}

      {showBulkModal && selectedFlatAdsets.length > 0 && (
        <AdsetBulkBudgetModal
          adsets={selectedFlatAdsets}
          vndRate={vndRate}
          onClose={() => setShowBulkModal(false)}
          onApplied={() => {
            setShowBulkModal(false);
            loadAllAdsets(displayedCampaigns);
          }}
        />
      )}
    </div>
    </div>
  );
}
