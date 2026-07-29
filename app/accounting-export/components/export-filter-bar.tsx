'use client';

import { Info } from 'lucide-react';
import type { GroupBy } from './results-table';

export interface Filters {
  preset: string;
  since: string;
  until: string;
  platform: 'facebook' | 'tiktok' | 'both';
  accountSearch: string;
  campaignSearch: string;
  ownerFilter: string;
  departmentFilter: string;
}

interface Props {
  filters: Filters;
  onChange: (next: Filters) => void;
  onRunExport: () => void;
  loading: boolean;
  ownerOptions: string[];
  departmentOptions: string[];
  groupBy: GroupBy;
  onGroupByChange: (groupBy: GroupBy) => void;
}

const PRESETS: { value: string; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last_7d', label: 'Last 7 days' },
  { value: 'last_14d', label: 'Last 14 days' },
  { value: 'last_30d', label: 'Last 30 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'maximum', label: 'Maximum' },
  { value: 'custom', label: 'Custom range…' },
];

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const inputCls = 'px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function ExportFilterBar({ filters, onChange, onRunExport, loading, ownerOptions, departmentOptions, groupBy, onGroupByChange }: Props) {
  const isCustom = filters.preset === 'custom';

  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="flex items-center gap-1 text-xs font-medium text-slate-600">
            Time range
            <span title="Facebook dates use each account's own reporting timezone; TikTok dates are UTC — spend near range boundaries may shift by up to a day.">
              <Info className="w-3.5 h-3.5 text-slate-400" />
            </span>
          </label>
          <select value={filters.preset} onChange={(e) => set('preset', e.target.value)} className={inputCls}>
            {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        {isCustom && (
          <div className="flex items-center gap-2">
            <input type="date" value={filters.since} max={filters.until || todayStr()} onChange={(e) => set('since', e.target.value)} className={inputCls} />
            <span className="text-slate-400 text-sm">→</span>
            <input type="date" value={filters.until} max={todayStr()} onChange={(e) => set('until', e.target.value)} className={inputCls} />
          </div>
        )}

        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600">Platform</label>
          <select value={filters.platform} onChange={(e) => set('platform', e.target.value as Filters['platform'])} className={inputCls}>
            <option value="both">Facebook + TikTok</option>
            <option value="facebook">Facebook only</option>
            <option value="tiktok">TikTok only</option>
          </select>
        </div>

        <button
          onClick={onRunExport}
          disabled={loading}
          className="px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Exporting…' : 'Run export'}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-slate-100">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600">Account (id or name)</label>
          <input type="text" value={filters.accountSearch} onChange={(e) => set('accountSearch', e.target.value)} placeholder="Search accounts…" className={inputCls} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600">Campaign name</label>
          <input type="text" value={filters.campaignSearch} onChange={(e) => set('campaignSearch', e.target.value)} placeholder="Search campaigns…" className={inputCls} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600">Owner</label>
          <select value={filters.ownerFilter} onChange={(e) => set('ownerFilter', e.target.value)} className={inputCls}>
            <option value="">All</option>
            {ownerOptions.map((o) => <option key={o} value={o}>{o || 'Unassigned'}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600">Department</label>
          <select value={filters.departmentFilter} onChange={(e) => set('departmentFilter', e.target.value)} className={inputCls}>
            <option value="">All</option>
            {departmentOptions.map((d) => <option key={d} value={d}>{d || 'Unassigned'}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600">Group by</label>
          <select value={groupBy} onChange={(e) => onGroupByChange(e.target.value as GroupBy)} className={inputCls}>
            <option value="none">None</option>
            <option value="owner">Owner</option>
            <option value="department">Department</option>
          </select>
        </div>
      </div>
    </div>
  );
}
