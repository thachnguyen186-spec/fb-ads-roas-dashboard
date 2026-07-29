'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, AlertTriangle, Download } from 'lucide-react';
import type { AccountingExportRow, UserRole } from '@/lib/types';
import { downloadAccountingCsv } from '@/lib/accounting/export-csv';
import ExportFilterBar, { type Filters } from './export-filter-bar';
import ResultsTable, { type SortKey, type SortState, type GroupBy } from './results-table';
import GroupingManager from './grouping-manager';

interface Props {
  userEmail: string;
  role: UserRole;
}

interface Coverage { role: UserRole; visibleUserCount?: number; totalOrgUserCount?: number }

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const DEFAULT_FILTERS: Filters = {
  preset: 'last_30d',
  since: todayStr(),
  until: todayStr(),
  platform: 'both',
  accountSearch: '',
  campaignSearch: '',
  ownerFilter: '',
  departmentFilter: '',
};

function rangeLabel(filters: Filters): string {
  return filters.preset === 'custom' ? `${filters.since}_${filters.until}` : filters.preset;
}

export default function AccountingExportHub({ userEmail, role }: Props) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [rawRows, setRawRows] = useState<AccountingExportRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [legAborted, setLegAborted] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>('none');

  async function runExport() {
    setError('');
    if (filters.preset === 'custom' && (!filters.since || !filters.until || filters.since > filters.until)) {
      setError('Pick a valid custom range (start on or before end).');
      return;
    }
    setLoading(true);
    try {
      const url = new URL('/api/accounting-export', window.location.origin);
      if (filters.preset === 'custom') {
        url.searchParams.set('since', filters.since);
        url.searchParams.set('until', filters.until);
      } else {
        url.searchParams.set('datePreset', filters.preset);
      }
      url.searchParams.set('platform', filters.platform);

      const res = await fetch(url.toString());
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Fetch failed (${res.status})`);

      setRawRows(json.rows ?? []);
      setWarnings(json.warnings ?? []);
      setCoverage(json.coverage ?? null);
      setLegAborted(json.leg_aborted ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setLoading(false);
    }
  }

  const filteredRows = useMemo(() => {
    const accountQ = filters.accountSearch.trim().toLowerCase();
    const campaignQ = filters.campaignSearch.trim().toLowerCase();
    return rawRows.filter((r) => {
      if (accountQ && !`${r.account_id} ${r.account_name}`.toLowerCase().includes(accountQ)) return false;
      if (campaignQ && !r.campaign_name.toLowerCase().includes(campaignQ)) return false;
      if (filters.ownerFilter && r.owner_label !== filters.ownerFilter) return false;
      if (filters.departmentFilter && r.department_label !== filters.departmentFilter) return false;
      return true;
    });
  }, [rawRows, filters.accountSearch, filters.campaignSearch, filters.ownerFilter, filters.departmentFilter]);

  const ownerOptions = useMemo(() => [...new Set(rawRows.map((r) => r.owner_label))].sort(), [rawRows]);
  const departmentOptions = useMemo(() => [...new Set(rawRows.map((r) => r.department_label))].sort(), [rawRows]);

  function handleSortChange(key: SortKey) {
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }

  function handleLabelChanged(accountId: string, platform: 'facebook' | 'tiktok', field: 'owner_label' | 'department_label', label: string) {
    setRawRows((prev) => prev.map((r) => (r.account_id === accountId && r.platform === platform ? { ...r, [field]: label } : r)));
  }

  function handleDownloadCsv() {
    downloadAccountingCsv(filteredRows, rangeLabel(filters), filters.platform);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="px-8 py-5 border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/tools" className="text-slate-400 hover:text-slate-700"><ChevronLeft className="w-5 h-5" /></Link>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Accounting Export</h1>
              <p className="text-xs text-slate-500">{userEmail} · {role}</p>
            </div>
          </div>
          {filteredRows.length > 0 && (
            <button onClick={handleDownloadCsv} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
              <Download className="w-4 h-4" /> Download CSV
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 py-6 space-y-4">
        <ExportFilterBar
          filters={filters}
          onChange={setFilters}
          onRunExport={runExport}
          loading={loading}
          ownerOptions={ownerOptions}
          departmentOptions={departmentOptions}
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        {coverage?.role === 'admin' && (
          <p className="text-xs text-slate-500">
            Showing spend for {coverage.visibleUserCount ?? 0} of {coverage.totalOrgUserCount ?? 0} users.
          </p>
        )}

        {legAborted.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Export aborted for {legAborted.join(', ')} after repeated failures — try again shortly.
          </div>
        )}

        {warnings.length > 0 && (
          <div className="px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 space-y-0.5">
            {warnings.map((w) => <p key={w}>{w}</p>)}
          </div>
        )}

        <ResultsTable rows={filteredRows} groupBy={groupBy} sort={sort} onSortChange={handleSortChange} />

        <div className="pt-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Manage Groupings</h2>
          <GroupingManager onLabelChanged={handleLabelChanged} />
        </div>
      </main>
    </div>
  );
}
