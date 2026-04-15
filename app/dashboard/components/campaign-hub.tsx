'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { parseAdjustCsv, aggregateByCampaignId, aggregateByAdSetId } from '@/lib/adjust/csv-parser';
import { mergeCampaigns } from '@/lib/adjust/merge';
import type { CampaignRow, FbAdAccount, MergedCampaign, StaffMember, UserRole } from '@/lib/types';
import AdjustCsvUpload from './adjust-csv-upload';
import CampaignTable from './campaign-table';
import RoasFilter from './roas-filter';
import ActionBar from './action-bar';

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
  const [mergedCampaigns, setMergedCampaigns] = useState<MergedCampaign[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [roasMin, setRoasMin] = useState('');
  const [roasMax, setRoasMax] = useState('');
  const [accountFilter, setAccountFilter] = useState(''); // '' = all accounts
  const [sortCol, setSortCol] = useState<keyof MergedCampaign>('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [vndRate, setVndRate] = useState(26000);
  const [rateInput, setRateInput] = useState('26000');
  const [zoom, setZoom] = useState(100);

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
    setMergedCampaigns([]);
    setSelectedIds(new Set());
    setAccountFilter('');
  }

  function handleRecalculate() {
    const rate = parseFloat(rateInput);
    if (isNaN(rate) || rate <= 0) return;
    setVndRate(rate);
    setMergedCampaigns(mergeCampaigns(rawFbCampaigns, adjustMapState, rate));
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
      const fbCampaigns = fbRes.campaigns as CampaignRow[];
      setRawFbCampaigns(fbCampaigns);
      setAdjustMapState(adjustMap);
      setAdjustAdSetMapState(adjustAdSetMap);
      const merged = mergeCampaigns(fbCampaigns, adjustMap, vndRate);
      setMergedCampaigns(merged);
      setPhase('results');
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

  const displayedCampaigns = useMemo(() => {
    let list = [...mergedCampaigns];
    if (accountFilter) list = list.filter((c) => c.account_id === accountFilter);
    const min = roasMin !== '' ? parseFloat(roasMin) : null;
    const max = roasMax !== '' ? parseFloat(roasMax) : null;
    if (min !== null) list = list.filter((c) => c.roas !== null && c.roas >= min);
    if (max !== null) list = list.filter((c) => c.roas !== null && c.roas <= max);
    list.sort((a, b) => {
      const av = (a[sortCol] ?? 0) as number;
      const bv = (b[sortCol] ?? 0) as number;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return list;
  }, [mergedCampaigns, accountFilter, roasMin, roasMax, sortCol, sortDir]);

  const selectedCampaigns = useMemo(
    () => displayedCampaigns.filter((c) => selectedIds.has(c.campaign_id)),
    [displayedCampaigns, selectedIds],
  );

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-slate-50" style={{ zoom: zoom / 100 }}>
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
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

      <main className="max-w-screen-xl mx-auto w-full px-6 py-6 flex flex-col gap-5">

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
          <div className="flex flex-col gap-4">
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

            {/* Filter bar: ROAS filter + account filter */}
            <div className="flex flex-wrap items-center gap-3">
              <RoasFilter
                roasMin={roasMin}
                roasMax={roasMax}
                onMinChange={setRoasMin}
                onMaxChange={setRoasMax}
                totalCount={mergedCampaigns.length}
                filteredCount={displayedCampaigns.length}
              />
              {accountOptions.length > 1 && (
                <select
                  value={accountFilter}
                  onChange={(e) => setAccountFilter(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">All accounts ({accountOptions.length})</option>
                  {accountOptions.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              )}
            </div>

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
            />
          </div>
        )}
      </main>

      {phase === 'results' && selectedCampaigns.length > 0 && (
        <ActionBar
          selectedCampaigns={selectedCampaigns}
          onActionComplete={() => { if (csvFile) { setPhase('analyzing'); handleAnalyze(); } }}
          onDeselect={() => setSelectedIds(new Set())}
          vndRate={vndRate}
        />
      )}
    </div>
  );
}
