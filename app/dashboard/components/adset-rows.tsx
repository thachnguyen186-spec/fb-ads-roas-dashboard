'use client';

import { Fragment, useState } from 'react';
import type { BudgetTarget, MergedAdSet, SnapshotAdSetRow, SnapshotComparison } from '@/lib/types';
import { roasColorClass, formatRoas, formatProfit } from '@/lib/adjust/merge';
import BudgetModal from './budget-modal';

function fmtUsd(v: number | null) {
  if (v === null || v === 0) return '—';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDelta(v: number | null) {
  if (v === null) return '—';
  return `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface Props {
  adsets: MergedAdSet[];
  loading: boolean;
  error: string | null;
  showAccountColumn: boolean;
  /** Total column count of the parent table (for colspan on status rows) */
  colCount: number;
  /** Called after a successful ad set budget update so parent can invalidate cache */
  onBudgetUpdate: () => void;
  /** VND→USD rate from parent, needed for original-currency budget display */
  vndRate: number;
  /** Ordered snapshot comparisons. Empty array = no snapshot selected. */
  snapshotComparisons: SnapshotComparison[];
}

/** Render 12 snapshot data + delta cells for one adset row, for a single comparison */
function renderSnapCols(adset: MergedAdSet, comp: SnapshotComparison) {
  const snap = comp.adsetMap.get(adset.adset_id) ?? null;
  const getPrev = (field: keyof SnapshotAdSetRow): number | null => {
    if (!comp.prevAdsetMap) return (adset as unknown as Record<string, number | null>)[field as string] as number | null;
    return (comp.prevAdsetMap.get(adset.adset_id)?.[field] ?? null) as number | null;
  };
  const deltaSpend = snap?.spend != null ? (getPrev('spend') ?? adset.spend) - snap.spend : null;
  const deltaRev = snap?.adjust_revenue != null && getPrev('adjust_revenue') != null
    ? (getPrev('adjust_revenue') ?? 0) - snap.adjust_revenue : null;
  const deltaRoas = snap?.roas != null && getPrev('roas') != null
    ? (getPrev('roas') ?? 0) - snap.roas : null;
  const deltaPct = snap?.profit_pct != null && getPrev('profit_pct') != null
    ? (getPrev('profit_pct') ?? 0) - snap.profit_pct : null;
  const deltaProfit = snap?.profit != null && getPrev('profit') != null
    ? (getPrev('profit') ?? 0) - snap.profit : null;
  return (
    <>
      <td className="px-3 py-2 text-right tabular-nums bg-amber-50/40 border-l border-amber-100 text-xs text-slate-700">
        {snap?.spend != null ? fmtUsd(snap.spend) : <span className="text-slate-300">—</span>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums bg-amber-50/40 text-xs text-slate-500">
        {snap?.cpm != null ? fmtUsd(snap.cpm) : <span className="text-slate-300">—</span>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums bg-amber-50/40 text-xs text-slate-500">
        {snap?.ctr != null && snap.ctr > 0 ? `${snap.ctr.toFixed(2)}%` : <span className="text-slate-300">—</span>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums bg-amber-50/40 text-xs text-slate-700">
        {snap?.adjust_revenue != null ? fmtUsd(snap.adjust_revenue) : <span className="text-slate-300">—</span>}
      </td>
      <td className={`px-3 py-2 text-right tabular-nums bg-amber-50/40 text-xs font-semibold ${roasColorClass(snap?.roas ?? null)}`}>
        {snap ? formatRoas(snap.roas) : <span className="text-slate-300">—</span>}
      </td>
      <td className={`px-3 py-2 text-right tabular-nums bg-amber-50/40 text-xs font-medium ${snap?.profit_pct == null ? 'text-slate-300' : snap.profit_pct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
        {snap?.profit_pct != null ? formatProfit(snap.profit_pct) : '—'}
      </td>
      <td className={`px-3 py-2 text-right tabular-nums bg-amber-50/40 text-xs font-medium ${snap?.profit == null ? 'text-slate-300' : snap.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
        {snap?.profit != null ? fmtUsd(snap.profit) : '—'}
      </td>
      <td className={`px-3 py-2 text-right tabular-nums bg-sky-50/40 border-l border-sky-100 text-xs font-semibold ${deltaSpend === null ? 'text-slate-300' : deltaSpend >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
        {fmtDelta(deltaSpend)}
      </td>
      <td className={`px-3 py-2 text-right tabular-nums bg-sky-50/40 text-xs font-semibold ${deltaRev === null ? 'text-slate-300' : deltaRev >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
        {fmtDelta(deltaRev)}
      </td>
      <td className={`px-3 py-2 text-right tabular-nums bg-sky-50/40 text-xs font-semibold ${deltaRoas === null ? 'text-slate-300' : deltaRoas >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
        {deltaRoas !== null ? `${deltaRoas >= 0 ? '+' : ''}${deltaRoas.toFixed(2)}x` : '—'}
      </td>
      <td className={`px-3 py-2 text-right tabular-nums bg-sky-50/40 text-xs font-semibold ${deltaPct === null ? 'text-slate-300' : deltaPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
        {deltaPct !== null ? `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%` : '—'}
      </td>
      <td className={`px-3 py-2 text-right tabular-nums bg-sky-50/40 text-xs font-semibold ${deltaProfit === null ? 'text-slate-300' : deltaProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
        {fmtDelta(deltaProfit)}
      </td>
    </>
  );
}

export default function AdSetRows({ adsets, loading, error, showAccountColumn, colCount, onBudgetUpdate, vndRate, snapshotComparisons }: Props) {
  const [budgetTarget, setBudgetTarget] = useState<BudgetTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

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
      onBudgetUpdate();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Budget update failed');
    } finally {
      setSaving(false);
    }
  }

  const subRowCls = 'bg-indigo-50/50 border-t border-slate-100 text-xs';

  if (loading) {
    return (
      <tr className={subRowCls}>
        <td colSpan={colCount} className="px-6 py-2 text-slate-400 italic">Loading ad sets…</td>
      </tr>
    );
  }

  if (error) {
    return (
      <tr className={subRowCls}>
        <td colSpan={colCount} className="px-6 py-2 text-red-600">{error}</td>
      </tr>
    );
  }

  if (adsets.length === 0) {
    return (
      <tr className={subRowCls}>
        <td colSpan={colCount} className="px-6 py-2 text-slate-400 italic">No active ad sets found.</td>
      </tr>
    );
  }

  return (
    <>
      {adsets.map((adset) => {
        const budgetVal = adset.budget_type === 'daily'
          ? adset.daily_budget
          : adset.budget_type === 'lifetime'
          ? adset.lifetime_budget
          : null;
        const isActive = adset.effective_status === 'ACTIVE';

        return (
          <tr key={adset.adset_id} className={`group ${subRowCls} hover:bg-indigo-50`}>
            <td className="sticky left-0 z-[1] px-4 py-2 text-slate-300 text-center bg-indigo-50/50 group-hover:bg-indigo-50">└</td>

            <td className="sticky left-10 z-[1] px-3 py-2 max-w-xs border-r border-slate-200 bg-indigo-50/50 group-hover:bg-indigo-50">
              <div className="font-medium text-slate-700 truncate" title={adset.adset_name}>{adset.adset_name}</div>
              <div className="text-slate-400 font-mono">{adset.adset_id}</div>
            </td>

            {showAccountColumn && <td className="px-3 py-2 bg-blue-50/40" />}

            <td className="px-3 py-2 bg-blue-50/40">
              {isActive
                ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">Active</span>
                : <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Paused</span>}
            </td>

            <td className="px-3 py-2 text-right tabular-nums text-slate-700 bg-blue-50/40">{fmtUsd(adset.spend)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-slate-500 bg-blue-50/40">{fmtUsd(adset.cpm)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-slate-500 bg-blue-50/40">
              {adset.ctr > 0 ? `${adset.ctr.toFixed(2)}%` : '—'}
            </td>

            <td className="px-3 py-2 text-right tabular-nums bg-blue-50/40 border-r border-slate-200">
              <div className="flex items-center justify-end gap-1.5">
                {adset.budget_type === 'cbo' ? (
                  <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-medium">CBO</span>
                ) : (
                  <>
                    <span className="text-slate-700">{fmtUsd(budgetVal)}</span>
                    <span className="text-slate-400">{adset.budget_type === 'daily' ? '/d' : ' lt'}</span>
                    {saving ? (
                      <span className="text-slate-400 text-xs">…</span>
                    ) : (
                      <button
                        onClick={() => setBudgetTarget({
                          id: adset.adset_id,
                          name: adset.adset_name,
                          budget_type: adset.budget_type,
                          daily_budget: adset.daily_budget,
                          lifetime_budget: adset.lifetime_budget,
                          entity_type: 'adset',
                          currency: adset.currency,
                          vndRate,
                        })}
                        className="text-indigo-500 hover:text-indigo-700 transition-colors"
                        title="Edit budget"
                      >
                        ✎
                      </button>
                    )}
                  </>
                )}
              </div>
              {saveError && <div className="text-red-600 text-xs mt-0.5">{saveError}</div>}
            </td>

            <td className="px-3 py-2 text-right tabular-nums text-slate-700 bg-emerald-50/40 border-r border-slate-200">
              {adset.has_adjust_data ? fmtUsd(adset.adjust_revenue) : <span className="text-slate-300">—</span>}
            </td>
            <td className="px-3 py-2 text-center bg-purple-50/40">
              {adset.has_adjust_data
                ? <span className="inline-flex items-center gap-1 font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">✓</span>
                : <span className="inline-flex items-center gap-1 font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">✗</span>}
            </td>
            <td className={`px-3 py-2 text-right font-semibold tabular-nums bg-purple-50/40 ${roasColorClass(adset.roas)}`}>
              {formatRoas(adset.roas)}
            </td>
            <td className={`px-3 py-2 text-right tabular-nums bg-purple-50/40 ${adset.profit_pct === null ? 'text-slate-300' : adset.profit_pct >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}`}>
              {formatProfit(adset.profit_pct)}
            </td>
            <td className={`px-3 py-2 text-right tabular-nums bg-purple-50/40 font-medium ${adset.profit === null ? 'text-slate-300' : adset.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {adset.profit !== null ? fmtUsd(adset.profit) : '—'}
            </td>

            {snapshotComparisons.map((comp) => <Fragment key={comp.id}>{renderSnapCols(adset, comp)}</Fragment>)}
          </tr>
        );
      })}

      {budgetTarget && (
        <BudgetModal
          target={budgetTarget}
          onConfirm={handleBudgetConfirm}
          onClose={() => setBudgetTarget(null)}
        />
      )}
    </>
  );
}
