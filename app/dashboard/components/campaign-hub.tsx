'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { parseAdjustCsv, aggregateByCampaignId } from '@/lib/adjust/csv-parser';
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
  const [mergedCampaigns, setMergedCampaigns] = useState<MergedCampaign[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [roasMin, setRoasMin] = useState('');
  const [roasMax, setRoasMax] = useState('');
  const [accountFilter, setAccountFilter] = useState(''); // '' = all accounts
  const [sortCol, setSortCol] = useState<keyof MergedCampaign>('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Determine if the current view has FB credentials configured
  const viewingAccounts = viewingStaff ? viewingStaff.accounts : selectedAccounts;
  const hasFbConfig = hasToken && viewingAccounts.length > 0;

  function handleStartOver() {
    setPhase('idle');
    setCsvFile(null);
    setMergedCampaigns([]);
    setSelectedIds(new Set());
    setAccountFilter('');
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
      const merged = mergeCampaigns(fbRes.campaigns as CampaignRow[], adjustMap);
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
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-gray-900">FB Ads ROAS</h1>
          {/* Leader/admin: staff switcher */}
          {(userRole === 'leader' || userRole === 'admin') && staffList.length > 0 && (
            <select
              value={viewingStaffId ?? ''}
              onChange={(e) => switchToStaff(e.target.value || null)}
              className="text-xs border border-gray-300 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">My dashboard</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>{s.email}</option>
              ))}
            </select>
          )}
          {viewingStaff && (
            <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
              Viewing: {viewingStaff.email}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {userRole === 'admin' && (
            <Link href="/admin" className="text-sm text-purple-600 hover:text-purple-800 font-medium">Admin</Link>
          )}
          <Link href="/settings" className="text-sm text-gray-500 hover:text-gray-700">Settings</Link>
          <button onClick={handleSignOut} className="text-sm text-gray-500 hover:text-gray-700">Sign out</button>
        </div>
      </header>

      <main className="flex-1 max-w-screen-xl mx-auto w-full px-6 py-6 space-y-5">

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
          <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5 max-w-lg">

            {/* Account summary (informational, not a selector) */}
            {hasFbConfig && (
              <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700">
                Will fetch active campaigns from <strong>{viewingAccounts.length}</strong> ad account{viewingAccounts.length !== 1 ? 's' : ''}:&nbsp;
                {viewingAccounts.map((a) => a.name).join(', ')}
              </div>
            )}

            {/* Step 1: Upload Adjust CSV */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-semibold">1</span>
                <h2 className="font-medium text-gray-900">Upload Adjust CSV</h2>
              </div>
              <p className="text-xs text-gray-500">Export from Adjust → Analytics → Campaign report</p>
              <AdjustCsvUpload onReady={handleCsvReady} disabled={!hasFbConfig} />
            </div>

            {phase === 'csv_ready' && (
              <>
                <hr className="border-gray-100" />
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-semibold">2</span>
                    <h2 className="font-medium text-gray-900">Fetch &amp; Analyze</h2>
                  </div>
                  <button
                    onClick={handleAnalyze}
                    className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Fetch all active campaigns &amp; match with CSV
                  </button>
                </div>
              </>
            )}

            {phase === 'analyzing' && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <svg className="animate-spin w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Fetching active campaigns from {viewingAccounts.length} account{viewingAccounts.length !== 1 ? 's' : ''}…
              </div>
            )}

            {phase === 'error' && (
              <div className="space-y-2">
                <p className="text-sm text-red-600">{errorMsg}</p>
                <button onClick={() => setPhase('csv_ready')} className="text-xs text-blue-600 hover:underline">Try again</button>
              </div>
            )}
          </div>
        )}

        {/* Results */}
        {phase === 'results' && (
          <div className="space-y-4">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 flex items-center justify-between">
              <span>⚠ Today&apos;s FB spend may be incomplete — insights delayed 6–48h. Active campaigns only.</span>
              <button onClick={handleStartOver} className="ml-4 text-amber-800 underline hover:no-underline whitespace-nowrap">Start over</button>
            </div>

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
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            />
          </div>
        )}
      </main>

      {phase === 'results' && selectedCampaigns.length > 0 && (
        <ActionBar
          selectedCampaigns={selectedCampaigns}
          onActionComplete={() => { if (csvFile) { setPhase('analyzing'); handleAnalyze(); } }}
          onDeselect={() => setSelectedIds(new Set())}
        />
      )}
    </div>
  );
}
