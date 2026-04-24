'use client';

import { useState } from 'react';
import { formatProfit } from '@/lib/adjust/merge';
import type { MergedAdSet, SnapshotComparison } from '@/lib/types';

interface Props {
  adsets: MergedAdSet[];
  vndRate: number;
  /** Snapshot comparisons currently added in the parent. Empty = only "Current" selectable. */
  snapshotComparisons: SnapshotComparison[];
  onClose: () => void;
  onApplied: () => void;
}

/** Values 'Current' uses, and what each snapshot entry surfaces. */
interface PerfMetrics {
  spend: number | null;
  cpi: number | null | undefined;
  roas: number | null;
  profit_pct: number | null;
}

function displayBudget(adset: MergedAdSet, vndRate: number): number | null {
  const budgetUsd =
    adset.budget_type === 'daily'
      ? adset.daily_budget
      : adset.budget_type === 'lifetime'
      ? adset.lifetime_budget
      : null;
  if (budgetUsd === null) return null;
  return adset.currency === 'VND' ? Math.round(budgetUsd * vndRate) : budgetUsd;
}

function fmtInputNum(v: number, isVnd: boolean): string {
  if (isVnd) return Math.round(v).toLocaleString('en-US');
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function parseInputNum(raw: string): number {
  return parseFloat(raw.replace(/,/g, ''));
}

function reformatInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (cleaned === '') return '';
  const [intStr, ...decParts] = cleaned.split('.');
  const intVal = parseInt(intStr || '0', 10);
  const formatted = isNaN(intVal) ? '' : intVal.toLocaleString('en-US');
  if (decParts.length > 0) return formatted + '.' + decParts.join('');
  return formatted;
}

/** Format a USD-denominated metric in the adset's native currency. */
function fmtMoney(valueUsd: number | null | undefined, currency: string, vndRate: number): string {
  if (valueUsd == null || valueUsd === 0) return '—';
  if (currency === 'VND') {
    return Math.round(valueUsd * vndRate).toLocaleString('en-US') + ' VND';
  }
  return '$' + valueUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtBudgetDisplay(adset: MergedAdSet, vndRate: number): string {
  const v = displayBudget(adset, vndRate);
  if (v === null) return 'CBO';
  if (adset.currency === 'VND') return v.toLocaleString('en-US') + ' VND';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AdsetBulkBudgetModal({ adsets, vndRate, snapshotComparisons, onClose, onApplied }: Props) {
  const [newBudgets, setNewBudgets] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const a of adsets) {
      const v = displayBudget(a, vndRate);
      init[a.adset_id] = v !== null ? fmtInputNum(v, a.currency === 'VND') : '';
    }
    return init;
  });
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<Record<string, 'ok' | 'err'>>({});
  const [error, setError] = useState('');
  /** 'current' or a snapshot.id — drives which data source renders in the 4 metric cells */
  const [versionId, setVersionId] = useState<string>('current');

  const selectedSnapshot =
    versionId === 'current' ? null : snapshotComparisons.find((c) => c.id === versionId) ?? null;

  /** Pull Spend/CPI/ROAS/%Profit either from the live adset or the selected snapshot. */
  function metricsFor(a: MergedAdSet): PerfMetrics {
    if (!selectedSnapshot) {
      return { spend: a.spend, cpi: a.cpi, roas: a.roas, profit_pct: a.profit_pct };
    }
    const snap = selectedSnapshot.adsetMap.get(a.adset_id);
    if (!snap) return { spend: null, cpi: null, roas: null, profit_pct: null };
    return { spend: snap.spend, cpi: snap.cpi, roas: snap.roas, profit_pct: snap.profit_pct };
  }

  function updateBudget(adsetId: string, val: string) {
    setNewBudgets((prev) => ({ ...prev, [adsetId]: reformatInput(val) }));
  }

  async function handleApplyAll() {
    setApplying(true);
    setError('');
    setResults({});

    const tasks = adsets
      .filter((a) => a.budget_type !== 'cbo')
      .map(async (a) => {
        const raw = newBudgets[a.adset_id];
        const amount = parseInputNum(raw ?? '');
        if (isNaN(amount) || amount <= 0) {
          setResults((r) => ({ ...r, [a.adset_id]: 'err' }));
          return;
        }
        try {
          const res = await fetch(`/api/adsets/${a.adset_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'budget', budget_type: a.budget_type, amount, currency: a.currency }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? 'Failed');
          setResults((r) => ({ ...r, [a.adset_id]: 'ok' }));
        } catch {
          setResults((r) => ({ ...r, [a.adset_id]: 'err' }));
        }
      });

    await Promise.all(tasks);
    setApplying(false);
    onApplied();
  }

  const editableAdsets = adsets.filter((a) => a.budget_type !== 'cbo');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xl w-full max-w-3xl p-6 space-y-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold text-slate-900">Bulk Change Ad Set Budget</h2>
            <p className="text-xs text-slate-500 mt-0.5">{editableAdsets.length} ad set{editableAdsets.length !== 1 ? 's' : ''} (CBO ad sets are skipped)</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">Metrics version:</label>
            <select
              value={versionId}
              onChange={(e) => setVersionId(e.target.value)}
              className="px-2 py-1 border border-slate-300 rounded text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="current">Current</option>
              {snapshotComparisons.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none ml-2">✕</button>
          </div>
        </div>

        <div className="overflow-auto flex-1">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-xs text-slate-500 font-medium">
                <th className="px-3 py-2 text-left">Ad Set</th>
                <th className="px-3 py-2 text-right">Spend</th>
                <th className="px-3 py-2 text-right">CPI</th>
                <th className="px-3 py-2 text-right">D0 ROAS</th>
                <th className="px-3 py-2 text-right">%Profit</th>
                <th className="px-3 py-2 text-right">Old Budget</th>
                <th className="px-3 py-2 text-right">New Budget</th>
                <th className="px-3 py-2 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {adsets.map((a) => {
                const isCbo = a.budget_type === 'cbo';
                const status = results[a.adset_id];
                const m = metricsFor(a);
                return (
                  <tr key={a.adset_id} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-800 truncate max-w-[200px]" title={a.adset_name}>{a.adset_name}</div>
                      <div className="text-xs text-slate-400 font-mono">{a.adset_id}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmtMoney(m.spend, a.currency, vndRate)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{fmtMoney(m.cpi, a.currency, vndRate)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${m.roas === null ? 'text-slate-300' : m.roas >= 2 ? 'text-emerald-600' : m.roas >= 1 ? 'text-amber-600' : 'text-red-600'}`}>
                      {m.roas !== null ? `${m.roas.toFixed(2)}x` : '—'}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${m.profit_pct === null ? 'text-slate-300' : m.profit_pct >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}`}>
                      {formatProfit(m.profit_pct)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                      {isCbo ? <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">CBO</span> : fmtBudgetDisplay(a, vndRate)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {!isCbo && (
                        <div className="flex items-center gap-1 justify-end">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={newBudgets[a.adset_id] ?? ''}
                            onChange={(e) => updateBudget(a.adset_id, e.target.value)}
                            className="w-32 px-2 py-1 border border-slate-300 rounded text-sm text-right text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 tabular-nums"
                          />
                          <span className="text-xs text-slate-400">{a.currency}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 w-8 text-center">
                      {status === 'ok' && <span className="text-emerald-600 text-xs">✓</span>}
                      {status === 'err' && <span className="text-red-600 text-xs">✗</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3 pt-2 border-t border-slate-200">
          <button onClick={onClose} className="flex-1 py-2 text-sm border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleApplyAll}
            disabled={applying || editableAdsets.length === 0}
            className="flex-1 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium"
          >
            {applying ? 'Applying…' : `Apply All (${editableAdsets.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
