'use client';

import { useState } from 'react';
import { roasColorClass, formatRoas, formatProfit } from '@/lib/adjust/merge';
import type { BudgetTarget, MergedAdSet, SnapshotAdSetRow } from '@/lib/types';
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
  /** Snapshot compare: map adset_id → saved metrics. Null = no snapshot selected. */
  snapshotAdSetMap: Map<string, SnapshotAdSetRow> | null;
}

export default function AdsetFlatView({ adsets, selectedIds, onSelectionChange, vndRate, showAccountColumn, snapshotAdSetMap }: Props) {
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
    <div className="h-full flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex-1 min-h-0 overflow-x-scroll overflow-y-scroll" style={{ scrollbarGutter: 'stable' }}>
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-slate-200">
              <th colSpan={2} className="bg-slate-50 border-r border-slate-200" />
              <th colSpan={showAccountColumn ? 6 : 5} className="px-3 py-1.5 text-center text-xs font-semibold text-blue-700 bg-blue-50 border-r border-blue-100 tracking-wide uppercase">
                Facebook Ads Data
              </th>
              <th className="px-3 py-1.5 text-center text-xs font-semibold text-emerald-700 bg-emerald-50 border-r border-emerald-100 tracking-wide uppercase">
                Adjust CSV
              </th>
              <th colSpan={4} className="px-3 py-1.5 text-center text-xs font-semibold text-purple-700 bg-purple-50 tracking-wide uppercase">
                Result
              </th>
              {snapshotAdSetMap !== null && (
                <th colSpan={4} className="px-3 py-1.5 text-center text-xs font-semibold text-amber-700 bg-amber-50 border-l border-amber-100 tracking-wide uppercase">
                  Snapshot Compare
                </th>
              )}
            </tr>
            <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium text-xs">
              <th className="w-10 px-4 py-2.5">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-slate-300 bg-white h-5 w-5 cursor-pointer" />
              </th>
              <th className="px-3 py-2.5 text-left whitespace-nowrap border-r border-slate-200">Ad Set / Campaign</th>
              {showAccountColumn && <th className="px-3 py-2.5 text-left whitespace-nowrap bg-blue-50">Account</th>}
              <th className="px-3 py-2.5 text-left whitespace-nowrap bg-blue-50">Status</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50">Spend</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50">CPM</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50">CTR (all)</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50 border-r border-blue-100">Budget</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-emerald-50 border-r border-emerald-100">Revenue</th>
              <th className="px-3 py-2.5 text-center whitespace-nowrap bg-purple-50">ID Match</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-purple-50">D0 ROAS</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-purple-50">%Profit</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-purple-50">Profit</th>
              {snapshotAdSetMap !== null && (
                <>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap bg-amber-50 border-l border-amber-100">Old ROAS</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap bg-amber-50">Old Profit</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap bg-amber-50">Δ ROAS</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap bg-amber-50">Δ Profit</th>
                </>
              )}
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
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 bg-blue-50/40">{fmtUsd(a.cpm)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 bg-blue-50/40">
                    {a.impressions > 0 ? `${((a.clicks / a.impressions) * 100).toFixed(2)}%` : '—'}
                  </td>
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
                  <td className={`px-3 py-2.5 text-right tabular-nums bg-purple-50/40 font-medium ${a.profit === null ? 'text-slate-300' : a.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {a.profit !== null ? fmtUsd(a.profit) : '—'}
                  </td>
                  {/* Snapshot compare: Old ROAS | Old Profit | Δ ROAS | Δ Profit */}
                  {snapshotAdSetMap !== null && (() => {
                    const snap = snapshotAdSetMap.get(a.adset_id) ?? null;
                    const deltaRoas = snap && a.roas !== null && snap.roas !== null ? a.roas - snap.roas : null;
                    const deltaProfit = snap && a.profit !== null && snap.profit !== null ? a.profit - snap.profit : null;
                    return (
                      <>
                        <td className={`px-3 py-2.5 text-right tabular-nums bg-amber-50/40 border-l border-amber-100 text-xs font-semibold ${roasColorClass(snap?.roas ?? null)}`}>
                          {snap ? formatRoas(snap.roas) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className={`px-3 py-2.5 text-right tabular-nums bg-amber-50/40 text-xs font-medium ${snap === null || snap.profit === null ? 'text-slate-300' : snap.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {snap?.profit !== null && snap?.profit !== undefined ? fmtUsd(snap.profit) : '—'}
                        </td>
                        <td className={`px-3 py-2.5 text-right tabular-nums bg-amber-50/40 text-xs font-semibold ${deltaRoas === null ? 'text-slate-300' : deltaRoas >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {deltaRoas !== null ? `${deltaRoas >= 0 ? '+' : ''}${deltaRoas.toFixed(2)}x` : '—'}
                        </td>
                        <td className={`px-3 py-2.5 text-right tabular-nums bg-amber-50/40 text-xs font-semibold ${deltaProfit === null ? 'text-slate-300' : deltaProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {deltaProfit !== null ? `${deltaProfit >= 0 ? '+' : '-'}$${Math.abs(deltaProfit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                        </td>
                      </>
                    );
                  })()}
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
