/**
 * Bulk budget editor for 2+ selected TikTok campaigns / ad groups — mirrors FB's
 * adset-bulk-budget-modal (per-row editable "New Budget") plus a "set all" shortcut.
 * INFINITE-mode items have no budget at this level and are listed as skipped, never PATCHed.
 */

'use client';

import { useState } from 'react';
import { TIKTOK_BUDGET_MODE_DAY, TIKTOK_BUDGET_MODE_INFINITE, TIKTOK_BUDGET_MODE_TOTAL } from '@/lib/tiktok/budget-limits';
import type { TiktokActionItem } from './tiktok-action-bar';

interface Props {
  entityType: 'campaign' | 'adgroup';
  items: TiktokActionItem[];
  /** DAY-mode minimum for this entity level (campaign 50, ad group 20). */
  minDailyBudget: number;
  /** Max parallel PATCHes — shared with the action bar's bulk status actions. */
  concurrency: number;
  applyBudget: (item: TiktokActionItem, amount: number) => Promise<void>;
  onClose: () => void;
  /** Fired after every apply run (even partial failure) so the parent refetches. */
  onApplied: () => void;
}

type RowResult = { ok: true } | { ok: false; error: string };

function fmtUsd(v: number): string {
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sanitizeInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const [int, ...dec] = cleaned.split('.');
  return dec.length > 0 ? `${int}.${dec.join('')}` : int;
}

export default function TiktokBulkBudgetModal({ entityType, items, minDailyBudget, concurrency, applyBudget, onClose, onApplied }: Props) {
  const isSkipped = (i: TiktokActionItem) => i.budget_mode === TIKTOK_BUDGET_MODE_INFINITE;
  const editable = items.filter((i) => !isSkipped(i));
  const label = entityType === 'campaign' ? 'campaign' : 'ad group';

  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(editable.map((i) => [i.id, String(i.budget)])),
  );
  const [setAll, setSetAll] = useState('');
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<Record<string, RowResult>>({});

  function rowError(item: TiktokActionItem): string | null {
    const n = parseFloat(amounts[item.id] ?? '');
    if (isNaN(n) || n <= 0) return 'Enter an amount';
    if (item.budget_mode === TIKTOK_BUDGET_MODE_DAY && n < minDailyBudget) return `Min $${minDailyBudget}/day`;
    return null;
  }

  function applySetAll(raw: string) {
    const v = sanitizeInput(raw);
    setSetAll(v);
    setAmounts(Object.fromEntries(editable.map((i) => [i.id, v === '' ? String(i.budget) : v])));
  }

  const invalidCount = editable.filter((i) => rowError(i) !== null).length;

  async function handleApply() {
    if (invalidCount > 0) return;
    setApplying(true);
    setResults({});
    for (let i = 0; i < editable.length; i += concurrency) {
      await Promise.all(
        editable.slice(i, i + concurrency).map(async (item) => {
          let result: RowResult;
          try {
            await applyBudget(item, parseFloat(amounts[item.id]));
            result = { ok: true };
          } catch (err) {
            result = { ok: false, error: err instanceof Error ? err.message : 'Failed' };
          }
          setResults((r) => ({ ...r, [item.id]: result }));
        }),
      );
    }
    setApplying(false);
  }

  // Refresh only when the modal closes: refreshing right after apply unmounts the modal and
  // hides the per-row ✓/✗ results before the user can read which items failed.
  function handleClose() {
    onClose();
    if (Object.keys(results).length > 0) onApplied();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-slate-900">Bulk Change {entityType === 'campaign' ? 'Campaign' : 'Ad Group'} Budget</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {editable.length} {label}{editable.length !== 1 ? 's' : ''} editable
              {items.length > editable.length && ` · ${items.length - editable.length} skipped`}
            </p>
          </div>
          <button onClick={handleClose} disabled={applying} className="text-slate-400 hover:text-slate-700 disabled:opacity-50 text-xl leading-none">✕</button>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <label className="text-xs text-slate-500">Set all to:</label>
          <div className="flex items-center gap-1">
            <span className="text-slate-400">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={setAll}
              onChange={(e) => applySetAll(e.target.value)}
              disabled={applying || editable.length === 0}
              placeholder="amount"
              className="w-28 px-2 py-1 border border-slate-300 rounded text-sm text-right text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 tabular-nums"
            />
          </div>
          <span className="text-[10px] text-slate-400">Min ${minDailyBudget}/day (daily budgets)</span>
        </div>

        <div className="overflow-auto flex-1">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-xs text-slate-500 font-medium">
                <th className="px-3 py-2 text-left">{entityType === 'campaign' ? 'Campaign' : 'Ad Group'}</th>
                <th className="px-3 py-2 text-right">Old Budget</th>
                <th className="px-3 py-2 text-right">New Budget</th>
                <th className="px-3 py-2 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => {
                const skipped = isSkipped(item);
                const result = results[item.id];
                const err = skipped ? null : rowError(item);
                const suffix = item.budget_mode === TIKTOK_BUDGET_MODE_DAY ? '/day' : item.budget_mode === TIKTOK_BUDGET_MODE_TOTAL ? ' total' : '';
                return (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-800 truncate max-w-[220px]" title={item.name}>{item.name}</div>
                      <div className="text-xs text-slate-400 font-mono">{item.id}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                      {skipped ? <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">Skipped</span> : fmtUsd(item.budget) + suffix}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {skipped ? (
                        <span className="text-xs text-slate-400">{entityType === 'campaign' ? 'budget set on ad groups' : 'no budget at this level'}</span>
                      ) : (
                        <div className="flex flex-col items-end gap-0.5">
                          <div className="flex items-center gap-1">
                            <span className="text-slate-400">$</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={amounts[item.id] ?? ''}
                              onChange={(e) => setAmounts((a) => ({ ...a, [item.id]: sanitizeInput(e.target.value) }))}
                              disabled={applying}
                              className="w-28 px-2 py-1 border border-slate-300 rounded text-sm text-right text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 tabular-nums"
                            />
                          </div>
                          {err && <span className="text-[10px] text-red-500">{err}</span>}
                          {result && !result.ok && <span className="text-[10px] text-red-500 max-w-[200px] truncate" title={result.error}>{result.error}</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 w-8 text-center">
                      {result?.ok === true && <span className="text-emerald-600 text-xs">✓</span>}
                      {result?.ok === false && <span className="text-red-600 text-xs">✗</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex gap-3 pt-2 border-t border-slate-200">
          <button onClick={handleClose} disabled={applying} className="flex-1 py-2 text-sm border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors">
            Close
          </button>
          <button
            onClick={handleApply}
            disabled={applying || editable.length === 0 || invalidCount > 0}
            className="flex-1 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium"
          >
            {applying ? 'Applying…' : `Apply All (${editable.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
