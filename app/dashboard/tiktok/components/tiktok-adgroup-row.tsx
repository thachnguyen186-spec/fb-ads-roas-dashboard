/** Single ad-group table row — extracted from tiktok-adgroup-flat-view.tsx to stay under the 200-line file guideline. */

'use client';

import { roasColorClass, formatRoas, formatProfit } from '@/lib/adjust/merge';
import { formatUsd } from '@/lib/utils';
import type { FlatTiktokAdGroup } from '@/lib/types';

interface Props {
  adgroup: FlatTiktokAdGroup;
  isSelected: boolean;
  onToggle: () => void;
  onEditBudget: () => void;
  savingBudget: boolean;
  showAdvertiserColumn: boolean;
  minDailyBudget: number;
}

export default function TiktokAdgroupRow({
  adgroup: a, isSelected, onToggle, onEditBudget, savingBudget, showAdvertiserColumn, minDailyBudget,
}: Props) {
  return (
    <tr className={`group hover:bg-slate-50 transition-colors ${isSelected ? 'bg-indigo-50' : ''}`}>
      <td className={`sticky left-0 z-[1] px-4 py-2.5 ${isSelected ? 'bg-indigo-50' : 'bg-white group-hover:bg-slate-50'}`}>
        <input type="checkbox" checked={isSelected} onChange={onToggle} className="rounded border-slate-300 bg-white h-5 w-5 cursor-pointer" />
      </td>
      <td className={`sticky left-10 z-[1] px-3 py-2.5 max-w-xs border-r border-slate-100 ${isSelected ? 'bg-indigo-50' : 'bg-white group-hover:bg-slate-50'}`}>
        <div className="font-medium text-slate-900 truncate" title={a.adgroup_name}>{a.adgroup_name}</div>
        <div className="text-xs text-slate-400 font-mono">{a.adgroup_id}</div>
        <div className="text-xs text-slate-500 truncate mt-0.5" title={a.campaign_name}>↳ {a.campaign_name}</div>
      </td>
      {showAdvertiserColumn && (
        <td className="px-3 py-2.5">
          <span className="text-xs text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">{a.advertiser_name}</span>
        </td>
      )}
      <td className="px-3 py-2.5">
        {a.status === 'ENABLE'
          ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">Enabled</span>
          : <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Disabled</span>}
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="flex items-center justify-end gap-1.5 tabular-nums text-slate-700">
          <span>{formatUsd(a.budget)}</span>
          <span className="text-slate-400 text-xs">{a.budget_mode === 'DAILY' ? '/d' : ' lt'}</span>
          {savingBudget ? (
            <span className="text-slate-400 text-xs">…</span>
          ) : (
            <button
              onClick={onEditBudget}
              className="text-indigo-500 hover:text-indigo-700 transition-colors text-xs"
              title={a.budget_mode === 'DAILY' ? `Edit budget (min $${minDailyBudget}/day)` : 'Edit budget'}
            >✎</button>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
        {a.has_adjust_data ? formatUsd(a.adjust_revenue) : <span className="text-slate-300">—</span>}
      </td>
      <td className="px-3 py-2.5 text-center">
        {a.has_adjust_data
          ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">✓</span>
          : <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">✗</span>}
      </td>
      <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${roasColorClass(a.roas)}`}>{formatRoas(a.roas)}</td>
      <td className={`px-3 py-2.5 text-right tabular-nums ${a.profit_pct === null ? 'text-slate-300' : a.profit_pct >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}`}>
        {formatProfit(a.profit_pct)}
      </td>
      <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${a.profit === null ? 'text-slate-300' : a.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
        {a.profit !== null ? formatUsd(a.profit) : '—'}
      </td>
    </tr>
  );
}
