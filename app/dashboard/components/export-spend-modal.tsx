'use client';

import { useState } from 'react';
import type { CampaignRow } from '@/lib/types';
import { groupSpendByApp, buildSpendCsv, type OutputCurrency } from '@/lib/spend-export';

interface Props {
  /** Dashboard's current VND→USD rate — used for both normalization and output conversion */
  vndRate: number;
  /** Leader/admin: staff user being viewed (passed through as ?viewAs=) */
  viewingStaffId: string | null;
  onClose: () => void;
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

export default function ExportSpendModal({ vndRate, viewingStaffId, onClose }: Props) {
  const [preset, setPreset] = useState('today');
  const [since, setSince] = useState(todayStr());
  const [until, setUntil] = useState(todayStr());
  const [currency, setCurrency] = useState<OutputCurrency>('USD');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isCustom = preset === 'custom';
  const rangeLabel = isCustom ? `${since} → ${until}` : (PRESETS.find((p) => p.value === preset)?.label ?? preset);

  async function handleExport() {
    setError('');
    if (isCustom && (!since || !until || since > until)) {
      setError('Pick a valid custom range (start on or before end).');
      return;
    }
    setLoading(true);
    try {
      const url = new URL('/api/campaigns', window.location.origin);
      if (isCustom) {
        url.searchParams.set('since', since);
        url.searchParams.set('until', until);
      } else if (preset !== 'today') {
        url.searchParams.set('datePreset', preset);
      }
      // Group by the campaign's Facebook app, resolved from its ad sets' promoted_object
      url.searchParams.set('appSource', 'adset');
      if (viewingStaffId) url.searchParams.set('viewAs', viewingStaffId);

      const res = await fetch(url.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Fetch failed (${res.status})`);

      const campaigns = (data.campaigns ?? []) as CampaignRow[];
      if (campaigns.length === 0) {
        setError('No spend found for this range.');
        return;
      }

      const rows = groupSpendByApp(campaigns, vndRate);
      const csv = buildSpendCsv(rows, currency, vndRate, rangeLabel);
      // Prepend UTF-8 BOM so Excel detects encoding and renders app names correctly
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `spend-by-app_${isCustom ? `${since}_${until}` : preset}_${currency}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Export Spend by App</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>

        {/* Time range */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-600">Time range</label>
          <select value={preset} onChange={(e) => setPreset(e.target.value)} className={`${inputCls} w-full`}>
            {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          {isCustom && (
            <div className="flex items-center gap-2 pt-1">
              <input type="date" value={since} max={until || todayStr()} onChange={(e) => setSince(e.target.value)} className={`${inputCls} flex-1`} />
              <span className="text-slate-400 text-sm">→</span>
              <input type="date" value={until} max={todayStr()} onChange={(e) => setUntil(e.target.value)} className={`${inputCls} flex-1`} />
            </div>
          )}
        </div>

        {/* Output currency */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-600">Output currency</label>
          <div className="flex gap-2">
            {(['USD', 'VND'] as const).map((cur) => (
              <button
                key={cur}
                onClick={() => setCurrency(cur)}
                className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${currency === cur ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
              >
                {cur}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400">Converted at 1 USD = {vndRate.toLocaleString('en-US')} VND (dashboard rate).</p>
        </div>

        <p className="text-xs text-slate-400">
          Includes active &amp; paused campaigns that spent in the range, grouped by their Facebook app (from the ad set&rsquo;s promoted app). Campaigns with no app set appear under &ldquo;Unmapped&rdquo;.
        </p>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
          <button
            onClick={handleExport}
            disabled={loading}
            className="px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Exporting…' : '↓ Download CSV'}
          </button>
        </div>
      </div>
    </div>
  );
}
