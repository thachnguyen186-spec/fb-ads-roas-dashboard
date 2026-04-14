'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { parseAdjustCsv, aggregateByCampaignId } from '@/lib/adjust/csv-parser';
import { mergeCampaigns } from '@/lib/adjust/merge';
import type { CampaignRow, FbAdAccount, MergedCampaign } from '@/lib/types';
import AdjustCsvUpload from './adjust-csv-upload';
import CampaignTable from './campaign-table';
import RoasFilter from './roas-filter';
import ActionBar from './action-bar';

type Phase = 'idle' | 'csv_ready' | 'analyzing' | 'results' | 'error';

interface Props {
  hasToken: boolean;
  selectedAccounts: FbAdAccount[];
}

export default function CampaignHub({ hasToken, selectedAccounts }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [appFilter, setAppFilter] = useState<string | undefined>(undefined);
  const [mergedCampaigns, setMergedCampaigns] = useState<MergedCampaign[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [roasMin, setRoasMin] = useState('');
  const [roasMax, setRoasMax] = useState('');
  const [sortCol, setSortCol] = useState<keyof MergedCampaign>('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeAccountId, setActiveAccountId] = useState<string>(
    selectedAccounts[0]?.account_id ?? '',
  );

  const hasFbConfig = hasToken && selectedAccounts.length > 0;

  function handleCsvReady(file: File, filter: string | undefined) {
    setCsvFile(file);
    setAppFilter(filter);
    setPhase('csv_ready');
  }

  async function handleAnalyze() {
    if (!csvFile || !activeAccountId) return;
    setPhase('analyzing');
    setErrorMsg('');
    setSelectedIds(new Set());

    try {
      const [fbRes, adjustRows] = await Promise.all([
        fetch(`/api/campaigns?accountId=${encodeURIComponent(activeAccountId)}`).then((r) =>
          r.json(),
        ),
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
    if (col === sortCol) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  }

  const displayedCampaigns = useMemo(() => {
    let list = [...mergedCampaigns];
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
  }, [mergedCampaigns, roasMin, roasMax, sortCol, sortDir]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const selectedCampaigns = useMemo(
    () => displayedCampaigns.filter((c) => selectedIds.has(c.campaign_id)),
    [displayedCampaigns, selectedIds],
  );

  function handleStartOver() {
    setPhase('idle');
    setCsvFile(null);
    setMergedCampaigns([]);
    setSelectedIds(new Set());
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-gray-900">FB Ads ROAS Dashboard</h1>
          {/* Account selector */}
          {selectedAccounts.length > 1 && (
            <select
              value={activeAccountId}
              onChange={(e) => {
                setActiveAccountId(e.target.value);
                handleStartOver();
              }}
              className="text-xs border border-gray-300 rounded-lg px-2 py-1 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {selectedAccounts.map((a) => (
                <option key={a.account_id} value={a.account_id}>
                  {a.name} ({a.account_id})
                </option>
              ))}
            </select>
          )}
          {selectedAccounts.length === 1 && (
            <span className="text-xs text-gray-500 font-mono">
              {selectedAccounts[0].name} · {selectedAccounts[0].account_id}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <Link href="/settings" className="text-sm text-gray-500 hover:text-gray-700">Settings</Link>
          <button onClick={handleSignOut} className="text-sm text-gray-500 hover:text-gray-700">Sign out</button>
        </div>
      </header>

      <main className="flex-1 max-w-screen-xl mx-auto w-full px-6 py-6 space-y-5">
        {/* No credentials callout */}
        {!hasFbConfig && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            {!hasToken
              ? 'Facebook access token not configured.'
              : 'No ad accounts selected.'}{' '}
            <Link href="/settings" className="font-medium underline">Go to Settings</Link>{' '}
            {!hasToken
              ? 'to add your access token and fetch ad accounts.'
              : 'to select ad accounts to use.'}
          </div>
        )}

        {/* Upload + Analyze section */}
        {phase !== 'results' && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4 max-w-lg">
            <div>
              <h2 className="font-medium text-gray-900 mb-0.5">Step 1 — Upload Adjust CSV</h2>
              <p className="text-xs text-gray-500">Export from Adjust → Analytics → Campaign report</p>
            </div>
            <AdjustCsvUpload onReady={handleCsvReady} disabled={!hasFbConfig} />

            {phase === 'csv_ready' && (
              <button
                onClick={handleAnalyze}
                className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                Step 2 — Analyze (fetch today&apos;s FB data)
              </button>
            )}

            {phase === 'analyzing' && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <svg className="animate-spin w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Fetching today&apos;s Facebook data…
              </div>
            )}

            {phase === 'error' && (
              <div className="space-y-2">
                <p className="text-sm text-red-600">{errorMsg}</p>
                <button onClick={() => setPhase('csv_ready')} className="text-xs text-blue-600 hover:underline">
                  Try again
                </button>
              </div>
            )}
          </div>
        )}

        {/* Results */}
        {phase === 'results' && (
          <div className="space-y-4">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 flex items-center justify-between">
              <span>⚠ Today&apos;s FB spend data may be incomplete — insights are delayed 6–48h.</span>
              <button
                onClick={handleStartOver}
                className="ml-4 text-xs text-amber-800 underline hover:no-underline whitespace-nowrap"
              >
                Start over
              </button>
            </div>
            <RoasFilter
              roasMin={roasMin}
              roasMax={roasMax}
              onMinChange={setRoasMin}
              onMaxChange={setRoasMax}
              totalCount={mergedCampaigns.length}
              filteredCount={displayedCampaigns.length}
            />
            <CampaignTable
              campaigns={displayedCampaigns}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              sortCol={sortCol}
              sortDir={sortDir}
              onSort={handleSort}
            />
          </div>
        )}
      </main>

      {phase === 'results' && selectedCampaigns.length > 0 && (
        <ActionBar
          selectedCampaigns={selectedCampaigns}
          onActionComplete={() => {
            if (csvFile) {
              setPhase('analyzing');
              handleAnalyze();
            }
          }}
          onDeselect={() => setSelectedIds(new Set())}
        />
      )}
    </div>
  );
}
