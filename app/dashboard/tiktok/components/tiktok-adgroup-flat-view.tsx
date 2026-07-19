/**
 * Ad-group flat table — mirrors adset-flat-view.tsx but drops snapshot-compare complexity
 * (YAGNI for Plan 1). Keeps sortable columns, selection, and inline per-row budget edit;
 * bulk on/off is handled by the shared tiktok-action-bar rendered alongside this view.
 * Row rendering lives in tiktok-adgroup-row.tsx to stay under the 200-line file guideline.
 */

'use client';

import { useMemo, useState } from 'react';
import { formatUsd } from '@/lib/utils';
import { toBudgetTargetType } from '@/lib/tiktok/budget-limits';
import type { BudgetTarget, FlatTiktokAdGroup } from '@/lib/types';
import BudgetModal from '@/app/dashboard/components/budget-modal';
import TiktokAdgroupRow from './tiktok-adgroup-row';

interface Props {
  adgroups: FlatTiktokAdGroup[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  showAdvertiserColumn: boolean;
  minDailyBudget: number;
  onBudgetUpdated: () => void;
}

export default function TiktokAdgroupFlatView({
  adgroups, selectedIds, onSelectionChange, showAdvertiserColumn, minDailyBudget, onBudgetUpdated,
}: Props) {
  const [budgetTarget, setBudgetTarget] = useState<BudgetTarget | null>(null);
  const [budgetRow, setBudgetRow] = useState<FlatTiktokAdGroup | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [sortCol, setSortCol] = useState('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function handleSort(col: string) {
    if (col === sortCol) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('desc'); }
  }

  const sorted = useMemo(() => {
    return [...adgroups].sort((a, b) => {
      const av = (a[sortCol as keyof FlatTiktokAdGroup] as number | null) ?? 0;
      const bv = (b[sortCol as keyof FlatTiktokAdGroup] as number | null) ?? 0;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [adgroups, sortCol, sortDir]);

  const allSelected = adgroups.length > 0 && adgroups.every((a) => selectedIds.has(a.adgroup_id));
  function toggleAll() {
    onSelectionChange(allSelected ? new Set() : new Set(adgroups.map((a) => a.adgroup_id)));
  }
  function toggleOne(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectionChange(next);
  }

  function openBudgetEdit(a: FlatTiktokAdGroup) {
    setBudgetRow(a);
    const budgetType = toBudgetTargetType(a.budget_mode);
    setBudgetTarget({
      id: a.adgroup_id,
      name: a.adgroup_name,
      budget_type: budgetType,
      daily_budget: budgetType === 'daily' ? a.budget : null,
      lifetime_budget: budgetType === 'lifetime' ? a.budget : null,
      entity_type: 'adset',
      currency: a.currency,
      vndRate: 1,
    });
  }

  async function handleBudgetConfirm(amount: number) {
    if (!budgetRow) return;
    const row = budgetRow;
    setBudgetTarget(null);
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch(`/api/tiktok/adgroups/${row.adgroup_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'budget', amount, advertiser_id: row.advertiser_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Budget update failed');
      onBudgetUpdated();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Budget update failed');
    } finally {
      setSaving(false);
      setBudgetRow(null);
    }
  }

  if (adgroups.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-400">
        No ad groups found for the current filter.
      </div>
    );
  }

  const totalSpend = sorted.reduce((s, a) => s + a.spend, 0);
  const totalRevenue = sorted.reduce((s, a) => s + (a.adjust_revenue ?? 0), 0);
  const totalAllRevenue = sorted.reduce((s, a) => s + (a.adjust_all_revenue ?? 0), 0);
  const totalProfit = sorted.reduce((s, a) => s + (a.profit ?? 0), 0);
  const avgRoas = totalSpend > 0 && totalRevenue > 0 ? totalRevenue / totalSpend : null;
  const avgProfitPct = totalAllRevenue > 0 ? ((totalAllRevenue - totalSpend) / totalAllRevenue) * 100 : null;
  const matchedCount = sorted.filter((a) => a.has_adjust_data).length;

  const th = 'px-3 py-2.5 text-right whitespace-nowrap bg-slate-100 border-b border-slate-300';

  return (
    <div className="h-full flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex-1 min-h-0 overflow-x-scroll overflow-y-scroll" style={{ scrollbarGutter: 'stable' }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead className="sticky top-0 z-10" style={{ boxShadow: '0 3px 10px rgba(0,0,0,0.12)' }}>
            <tr className="bg-slate-100 text-slate-600 font-semibold">
              <th className="sticky left-0 z-20 w-10 px-4 py-2.5 border-b border-slate-300 bg-slate-100">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-slate-300 bg-white h-5 w-5 cursor-pointer" />
              </th>
              <th className="sticky left-10 z-20 px-3 py-2.5 text-left whitespace-nowrap border-r border-slate-300 border-b border-slate-300 bg-slate-100">Ad Group / Campaign</th>
              {showAdvertiserColumn && <th className="px-3 py-2.5 text-left whitespace-nowrap bg-slate-100 border-b border-slate-300">Advertiser</th>}
              <th className="px-3 py-2.5 text-left whitespace-nowrap bg-slate-100 border-b border-slate-300">Status</th>
              <th className={th}>Budget</th>
              <th className={`${th} cursor-pointer`} onClick={() => handleSort('spend')}>Spend</th>
              <th className={`${th} cursor-pointer`} onClick={() => handleSort('adjust_revenue')}>Revenue</th>
              <th className="px-3 py-2.5 text-center whitespace-nowrap bg-slate-100 border-b border-slate-300">ID Match</th>
              <th className={`${th} cursor-pointer`} onClick={() => handleSort('roas')}>ROAS</th>
              <th className={`${th} cursor-pointer`} onClick={() => handleSort('profit_pct')}>%Profit</th>
              <th className={`${th} cursor-pointer`} onClick={() => handleSort('profit')}>Profit</th>
            </tr>
            <tr className="bg-slate-100 text-sm font-semibold text-slate-700">
              <th className="sticky left-0 z-20 w-10 px-4 py-2 border-b-2 border-slate-400 bg-slate-100" />
              <th className="sticky left-10 z-20 px-3 py-2 text-left text-slate-500 font-medium border-r border-slate-300 border-b-2 border-slate-400 whitespace-nowrap bg-slate-100">
                {sorted.length} ad groups · {matchedCount} matched
              </th>
              {showAdvertiserColumn && <th className="px-3 py-2 bg-slate-100 border-b-2 border-slate-400" />}
              <th className="px-3 py-2 bg-slate-100 border-b-2 border-slate-400" />
              <th className="px-3 py-2 text-right bg-slate-100 border-b-2 border-slate-400 text-slate-400">—</th>
              <th className="px-3 py-2 text-right tabular-nums bg-slate-100 border-b-2 border-slate-400">{formatUsd(totalSpend)}</th>
              <th className="px-3 py-2 text-right tabular-nums bg-slate-100 border-b-2 border-slate-400">
                {totalRevenue > 0 ? formatUsd(totalRevenue) : <span className="text-slate-400">—</span>}
              </th>
              <th className="px-3 py-2 text-center text-slate-400 bg-slate-100 border-b-2 border-slate-400">—</th>
              <th className={`px-3 py-2 text-right tabular-nums bg-slate-100 border-b-2 border-slate-400 ${avgRoas === null ? 'text-slate-400' : avgRoas >= 2 ? 'text-emerald-600' : avgRoas >= 1 ? 'text-amber-600' : 'text-red-600'}`}>
                {avgRoas !== null ? `${avgRoas.toFixed(2)}x` : '—'}
              </th>
              <th className={`px-3 py-2 text-right tabular-nums bg-slate-100 border-b-2 border-slate-400 ${avgProfitPct === null ? 'text-slate-400' : avgProfitPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {avgProfitPct !== null ? `${avgProfitPct >= 0 ? '+' : ''}${avgProfitPct.toFixed(1)}%` : '—'}
              </th>
              <th className={`px-3 py-2 text-right tabular-nums bg-slate-100 border-b-2 border-slate-400 ${totalProfit === 0 ? 'text-slate-400' : totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {totalRevenue > 0 ? formatUsd(totalProfit) : <span className="text-slate-400">—</span>}
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {sorted.map((a) => (
              <TiktokAdgroupRow
                key={a.adgroup_id}
                adgroup={a}
                isSelected={selectedIds.has(a.adgroup_id)}
                onToggle={() => toggleOne(a.adgroup_id)}
                onEditBudget={() => openBudgetEdit(a)}
                savingBudget={saving && budgetRow?.adgroup_id === a.adgroup_id}
                showAdvertiserColumn={showAdvertiserColumn}
                minDailyBudget={minDailyBudget}
              />
            ))}
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
        <BudgetModal target={budgetTarget} onConfirm={(amount) => handleBudgetConfirm(amount)} onClose={() => { setBudgetTarget(null); setBudgetRow(null); }} />
      )}
    </div>
  );
}
