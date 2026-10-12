/**
 * Budget editor for 1+ selected TikTok campaigns / ad groups — mirrors FB's adset-bulk-budget-modal
 * (comparative Spend/ROAS/%Profit/Profit columns with a Current/snapshot version selector, per-row
 * editable "New Budget") plus a "set all" shortcut and FB's -50/-20/+20/+50% quick buttons.
 * INFINITE-mode items have no budget at this level and are listed as skipped, never PATCHed.
 */

'use client';

import { useState } from 'react';
import { toBudgetTargetType } from '@/lib/tiktok/budget-limits';
import type { SnapshotComparison } from '@/lib/types';
import TiktokBulkBudgetRow, { type RowResult } from './tiktok-bulk-budget-row';
import TiktokBudgetPctButtons from './tiktok-budget-pct-buttons';
import { metricsForVersion } from './tiktok-budget-metrics';
import type { TiktokActionItem } from './tiktok-action-bar';

interface Props {
  entityType: 'campaign' | 'adgroup';
  items: TiktokActionItem[];
  /** DAY-mode minimum for this entity level (campaign 50, ad group 20). */
  concurrency: number;
  /** Campaign-level snapshots for the version selector; [] for ad groups (snapshots are campaign-only). */
  snapshotComparisons: SnapshotComparison[];
  applyBudget: (item: TiktokActionItem, amount: number) => Promise<void>;
  onClose: () => void;
  /** Fired after every apply run (even partial failure) so the parent refetches. */
  onApplied: () => void;
}

function sanitizeInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const [int, ...dec] = cleaned.split('.');
  return dec.length > 0 ? `${int}.${dec.join('')}` : int;
}

export default function TiktokBulkBudgetModal({ entityType, items, concurrency, snapshotComparisons, applyBudget, onClose, onApplied }: Props) {
  // Skip rows with no editable budget here (INFINITE / unknown mode) so one can't block Apply.
  const isSkipped = (i: TiktokActionItem) => !['daily', 'lifetime'].includes(toBudgetTargetType(i.budget_mode));
  const editable = items.filter((i) => !isSkipped(i));
  const label = entityType === 'campaign' ? 'campaign' : 'ad group';

  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(editable.map((i) => [i.id, String(i.budget)])),
  );
  const [setAll, setSetAll] = useState('');
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [versionId, setVersionId] = useState('current');
  const selectedSnapshot = versionId === 'current' ? null : snapshotComparisons.find((c) => c.id === versionId) ?? null;

  function rowError(item: TiktokActionItem): string | null {
    const n = parseFloat(amounts[item.id] ?? '');
    if (isNaN(n) || n <= 0) return 'Enter an amount';
    return null;
  }

  function applySetAll(raw: string) {
    const v = sanitizeInput(raw);
    setSetAll(v);
    setAmounts(Object.fromEntries(editable.map((i) => [i.id, v === '' ? String(i.budget) : v])));
  }

  /** Quick adjust: each editable row = its ORIGINAL budget × (1 + pct). Min-budget violations surface via rowError. */
  function applyPct(pct: number) {
    setSetAll('');
    setAmounts(Object.fromEntries(
      editable.map((i) => [i.id, String(Math.max(1, Math.round(i.budget * (1 + pct / 100) * 100) / 100))]),
    ));
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
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xl w-full max-w-4xl p-6 space-y-4 max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-slate-900">{items.length > 1 ? 'Bulk Change' : 'Change'} {entityType === 'campaign' ? 'Campaign' : 'Ad Group'} Budget</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {editable.length} {label}{editable.length !== 1 ? 's' : ''} editable
              {items.length > editable.length && ` · ${items.length - editable.length} skipped`}
            </p>
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
            <button onClick={handleClose} disabled={applying} className="text-slate-400 hover:text-slate-700 disabled:opacity-50 text-xl leading-none ml-2">✕</button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
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
          <TiktokBudgetPctButtons disabled={applying || editable.length === 0} onPct={applyPct} />
        </div>

        <div className="overflow-auto flex-1">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-xs text-slate-500 font-medium">
                <th className="px-3 py-2 text-left">{entityType === 'campaign' ? 'Campaign' : 'Ad Group'}</th>
                <th className="px-3 py-2 text-right">Spend</th>
                <th className="px-3 py-2 text-right">ROAS</th>
                <th className="px-3 py-2 text-right">%Profit</th>
                <th className="px-3 py-2 text-right">Profit</th>
                <th className="px-3 py-2 text-right">Old Budget</th>
                <th className="px-3 py-2 text-right">New Budget</th>
                <th className="px-3 py-2 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => {
                const skipped = isSkipped(item);
                return (
                  <TiktokBulkBudgetRow
                    key={item.id}
                    item={item}
                    entityType={entityType}
                    skipped={skipped}
                    metrics={metricsForVersion(item.id, item.metrics, selectedSnapshot)}
                    value={amounts[item.id] ?? ''}
                    error={skipped ? null : rowError(item)}
                    result={results[item.id]}
                    disabled={applying}
                    onChange={(raw) => setAmounts((a) => ({ ...a, [item.id]: sanitizeInput(raw) }))}
                  />
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
            {applying ? 'Applying…' : editable.length === 1 ? 'Apply' : `Apply All (${editable.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
