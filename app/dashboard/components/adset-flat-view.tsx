'use client';

import { useState } from 'react';
import { roasColorClass, formatRoas, formatProfit } from '@/lib/adjust/merge';
import type { BudgetTarget, MergedAdSet } from '@/lib/types';
import BudgetModal from './budget-modal';

function fmtUsd(v: number | null) {
  if (v === null || v === 0) return '—';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(v: number | null) {
  if (v === null) return '—';
  return v.toLocaleString('en-US');
}

/** MergedAdSet enriched with campaign_name for the flat view */
export interface FlatAdSet extends MergedAdSet {
  campaign_name: string;
}

interface Props {
  adsets: FlatAdSet[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  vndRate: number;
  showAccountColumn: boolean;
}

export default function AdsetFlatView({ adsets, selectedIds, onSelectionChange, vndRate, showAccountColumn }: Props) {
  const [budgetTarget, setBudgetTarget] = useState<BudgetTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const allSelected = adsets.length > 0 && adsets.every((a) => selectedIds.has(a.adset_id));

  function toggleAll() {
    onSelectionChange(allSelected ? new Set() : new Set(adsets.map((a) => a.adset_id)));
  }
  function toggleOne(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectionChange(next);
  }

  async function handleBudgetConfirm(amount: number, currency: string) {
    if (!budgetTarget) return;
    const target = budgetTarget;
    setBudgetTarget(null);
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch(`/api/adsets/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'budget', budget_type: target.budget_type, amount, currency }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Budget update failed');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Budget update failed');
    } finally {
      setSaving(false);
    }
  }

  if (adsets.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-400">
        No ad sets found. Try expanding campaigns first or check your filters.
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="overflow-x-scroll" style={{ scrollbarGutter: 'stable' }}>
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-11 z-10">
            <tr className="border-b border-slate-200">
              <th colSpan={2} className="bg-slate-50 border-r border-slate-200" />
              <th colSpan={showAccountColumn ? 8 : 7} className="px-3 py-1.5 text-center text-xs font-semibold text-blue-700 bg-blue-50 border-r border-blue-100 tracking-wide uppercase">
                Facebook Ads Data
              </th>
              <th className="px-3 py-1.5 text-center text-xs font-semibold text-emerald-700 bg-emerald-50 border-r border-emerald-100 tracking-wide uppercase">
                Adjust CSV
              </th>
              <th colSpan={3} className="px-3 py-1.5 text-center text-xs font-semibold text-purple-700 bg-purple-50 tracking-wide uppercase">
                Result
              </th>
            </tr>
            <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium text-xs">
              <th className="w-10 px-4 py-2.5">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-slate-300 bg-white h-5 w-5 cursor-pointer" />
              </th>
              <th className="px-3 py-2.5 text-left whitespace-nowrap border-r border-slate-200">Ad Set / Campaign</th>
              {showAccountColumn && <th className="px-3 py-2.5 text-left whitespace-nowrap bg-blue-50">Account</th>}
              <th className="px-3 py-2.5 text-left whitespace-nowrap bg-blue-50">Status</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50">Spend</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50">Impr.</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50">Clicks</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50">CPM</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50">CPC</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50 border-r border-blue-100">Budget</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-emerald-50 border-r border-emerald-100">Revenue</th>
              <th className="px-3 py-2.5 text-center whitespace-nowrap bg-purple-50">ID Match</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-purple-50">D0 ROAS</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-purple-50">%Profit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {adsets.map((a) => {
              const budgetVal = a.budget_type === 'daily' ? a.daily_budget : a.budget_type === 'lifetime' ? a.lifetime_budget : null;
              const isSelected = selectedIds.has(a.adset_id);
              return (
                <tr key={a.adset_id} className={`hover:bg-slate-50 transition-colors ${isSelected ? 'bg-indigo-50' : ''}`}>
                  <td className="px-4 py-2.5">
                    <input type="checkbox" checked={isSelected} onChange={() => toggleOne(a.adset_id)} className="rounded border-slate-300 bg-white h-5 w-5 cursor-pointer" />
                  </td>
                  <td className="px-3 py-2.5 max-w-xs border-r border-slate-100">
                    <div className="font-medium text-slate-900 truncate" title={a.adset_name}>{a.adset_name}</div>
                    <div className="text-xs text-slate-400 font-mono">{a.adset_id}</div>
                    <div className="text-xs text-slate-500 truncate mt-0.5" title={a.campaign_name}>↳ {a.campaign_name}</div>
                  </td>
                  {showAccountColumn && (
                    <td className="px-3 py-2.5 bg-blue-50/40">
                      <span className="text-xs text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">{a.account_name}</span>
                    </td>
                  )}
                  <td className="px-3 py-2.5 bg-blue-50/40">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">Active</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 bg-blue-50/40">{fmtUsd(a.spend)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 bg-blue-50/40">{fmtNum(a.impressions)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 bg-blue-50/40">{fmtNum(a.clicks)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 bg-blue-50/40">{fmtUsd(a.cpm)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 bg-blue-50/40">{fmtUsd(a.cpc)}</td>
                  <td className="px-3 py-2.5 text-right bg-blue-50/40 border-r border-blue-100">
                    {a.budget_type === 'cbo' ? (
                      <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-medium">CBO</span>
                    ) : (
                      <div className="flex items-center justify-end gap-1.5 tabular-nums text-slate-700">
                        <span>{fmtUsd(budgetVal)}</span>
                        <span className="text-slate-400 text-xs">{a.budget_type === 'daily' ? '/d' : ' lt'}</span>
                        {saving ? (
                          <span className="text-slate-400 text-xs">…</span>
                        ) : (
                          <button
                            onClick={() => setBudgetTarget({ id: a.adset_id, name: a.adset_name, budget_type: a.budget_type, daily_budget: a.daily_budget, lifetime_budget: a.lifetime_budget, entity_type: 'adset', currency: a.currency, vndRate })}
                            className="text-indigo-500 hover:text-indigo-700 transition-colors text-xs"
                            title="Edit budget"
                          >✎</button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 bg-emerald-50/40 border-r border-emerald-100">
                    {a.has_adjust_data ? fmtUsd(a.adjust_revenue) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center bg-purple-50/40">
                    {a.has_adjust_data
                      ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">✓</span>
                      : <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">✗</span>}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-semibold tabular-nums bg-purple-50/40 ${roasColorClass(a.roas)}`}>
                    {formatRoas(a.roas)}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums bg-purple-50/40 ${a.profit_pct === null ? 'text-slate-300' : a.profit_pct >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}`}>
                    {formatProfit(a.profit_pct)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {saveError && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-200 text-xs text-red-600 flex items-center justify-between">
          <span>{saveError}</span>
          <button onClick={() => setSaveError('')} className="text-red-400 hover:text-red-700 ml-4">✕</button>
        </div>
      )}

      {budgetTarget && (
        <BudgetModal target={budgetTarget} onConfirm={handleBudgetConfirm} onClose={() => setBudgetTarget(null)} />
      )}
    </div>
  );
}
