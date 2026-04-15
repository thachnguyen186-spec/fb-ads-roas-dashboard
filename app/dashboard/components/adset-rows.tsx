'use client';

import { useState } from 'react';
import type { BudgetTarget, MergedAdSet } from '@/lib/types';
import { roasColorClass, formatRoas } from '@/lib/adjust/merge';
import BudgetModal from './budget-modal';

function fmtUsd(v: number | null) {
  if (v === null || v === 0) return '—';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(v: number | null) {
  if (v === null) return '—';
  return v.toLocaleString('en-US');
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
}

export default function AdSetRows({ adsets, loading, error, showAccountColumn, colCount, onBudgetUpdate, vndRate }: Props) {
  const [budgetTarget, setBudgetTarget] = useState<BudgetTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  async function handleBudgetConfirm(amount: number, currency: string) {
    if (!budgetTarget) return;
    const target = budgetTarget; // capture before clearing
    setBudgetTarget(null);       // close modal immediately for snappy UX
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

  const subRowCls = 'bg-indigo-950/20 border-t border-slate-800 text-xs';

  if (loading) {
    return (
      <tr className={subRowCls}>
        <td colSpan={colCount} className="px-6 py-2 text-slate-500 italic">Loading ad sets…</td>
      </tr>
    );
  }

  if (error) {
    return (
      <tr className={subRowCls}>
        <td colSpan={colCount} className="px-6 py-2 text-red-400">{error}</td>
      </tr>
    );
  }

  if (adsets.length === 0) {
    return (
      <tr className={subRowCls}>
        <td colSpan={colCount} className="px-6 py-2 text-slate-500 italic">No active ad sets found.</td>
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

        return (
          <tr key={adset.adset_id} className={`${subRowCls} hover:bg-indigo-950/40`}>
            {/* Indent / tree marker */}
            <td className="px-4 py-2 text-slate-600 text-center">└</td>

            {/* Ad Set name + ID */}
            <td className="px-3 py-2 max-w-xs border-r border-slate-700">
              <div className="font-medium text-slate-200 truncate" title={adset.adset_name}>{adset.adset_name}</div>
              <div className="text-slate-500 font-mono">{adset.adset_id}</div>
            </td>

            {/* Account (blank — same as campaign) */}
            {showAccountColumn && <td className="px-3 py-2 bg-blue-950/10" />}

            {/* Status */}
            <td className="px-3 py-2 bg-blue-950/10">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-900/50 text-emerald-400">Active</span>
            </td>

            {/* Spend */}
            <td className="px-3 py-2 text-right tabular-nums text-slate-300 bg-blue-950/10">{fmtUsd(adset.spend)}</td>
            {/* Impr */}
            <td className="px-3 py-2 text-right tabular-nums text-slate-400 bg-blue-950/10">{fmtNum(adset.impressions)}</td>
            {/* Clicks */}
            <td className="px-3 py-2 text-right tabular-nums text-slate-400 bg-blue-950/10">{fmtNum(adset.clicks)}</td>
            {/* CPM */}
            <td className="px-3 py-2 text-right tabular-nums text-slate-400 bg-blue-950/10">{fmtUsd(adset.cpm)}</td>
            {/* CPC */}
            <td className="px-3 py-2 text-right tabular-nums text-slate-400 bg-blue-950/10">{fmtUsd(adset.cpc)}</td>

            {/* Budget */}
            <td className="px-3 py-2 text-right tabular-nums bg-blue-950/10 border-r border-slate-700">
              <div className="flex items-center justify-end gap-1.5">
                {adset.budget_type === 'cbo' ? (
                  <span className="text-xs bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded font-medium">CBO</span>
                ) : (
                  <>
                    <span className="text-slate-300">{fmtUsd(budgetVal)}</span>
                    <span className="text-slate-500">{adset.budget_type === 'daily' ? '/d' : ' lt'}</span>
                    {saving ? (
                      <span className="text-slate-500 text-xs">…</span>
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
                        className="text-indigo-400 hover:text-indigo-300 transition-colors"
                        title="Edit budget"
                      >
                        ✎
                      </button>
                    )}
                  </>
                )}
              </div>
              {saveError && <div className="text-red-400 text-xs mt-0.5">{saveError}</div>}
            </td>

            {/* Adjust revenue */}
            <td className="px-3 py-2 text-right tabular-nums text-slate-300 bg-emerald-950/20 border-r border-slate-700">
              {adset.has_adjust_data ? fmtUsd(adset.adjust_revenue) : <span className="text-slate-600">—</span>}
            </td>

            {/* ID Match */}
            <td className="px-3 py-2 text-center bg-purple-950/20">
              {adset.has_adjust_data
                ? <span className="inline-flex items-center gap-1 font-medium text-emerald-400 bg-emerald-900/40 px-2 py-0.5 rounded-full">✓</span>
                : <span className="inline-flex items-center gap-1 font-medium text-slate-500 bg-slate-700/50 px-2 py-0.5 rounded-full">✗</span>}
            </td>

            {/* ROAS */}
            <td className={`px-3 py-2 text-right font-semibold tabular-nums bg-purple-950/20 ${roasColorClass(adset.roas)}`}>
              {formatRoas(adset.roas)}
            </td>
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
