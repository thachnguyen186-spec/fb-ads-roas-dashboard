'use client';

import { useState } from 'react';
import type { BudgetTarget } from '@/lib/types';

interface Props {
  target: BudgetTarget;
  /** Called with the new budget in the account's native currency (VND or USD) */
  onConfirm: (amount: number, currency: string) => void;
  onClose: () => void;
}

const PCT_BUTTONS = [
  { label: '−50%', pct: -50, cls: 'bg-red-950/60 text-red-400 border-red-800 hover:bg-red-900/60' },
  { label: '−20%', pct: -20, cls: 'bg-orange-950/60 text-orange-400 border-orange-800 hover:bg-orange-900/60' },
  { label: '+20%', pct: 20,  cls: 'bg-emerald-950/60 text-emerald-400 border-emerald-800 hover:bg-emerald-900/60' },
  { label: '+50%', pct: 50,  cls: 'bg-green-950/60 text-green-400 border-green-800 hover:bg-green-900/60' },
];

export default function BudgetModal({ target, onConfirm, onClose }: Props) {
  const isVnd = target.currency === 'VND';

  // currentBudget is in USD (after merge conversion)
  const currentBudgetUsd =
    target.budget_type === 'daily'
      ? target.daily_budget
      : target.budget_type === 'lifetime'
      ? target.lifetime_budget
      : null;

  // Display budget in original currency
  const currentDisplayBudget =
    currentBudgetUsd !== null
      ? isVnd
        ? Math.round(currentBudgetUsd * target.vndRate)
        : currentBudgetUsd
      : null;

  const [value, setValue] = useState(
    currentDisplayBudget !== null ? String(currentDisplayBudget) : '',
  );

  function applyPct(pct: number) {
    if (currentDisplayBudget === null) return;
    const next = isVnd
      ? Math.max(1000, Math.round(currentDisplayBudget * (1 + pct / 100)))
      : Math.max(1, Math.round(currentDisplayBudget * (1 + pct / 100) * 100) / 100);
    setValue(String(next));
  }

  function handleConfirm() {
    const displayAmt = parseFloat(value);
    if (isNaN(displayAmt) || displayAmt <= 0) return;
    onConfirm(displayAmt, target.currency);
  }

  const budgetLabel =
    target.budget_type === 'daily'
      ? 'Daily budget'
      : target.budget_type === 'lifetime'
      ? 'Lifetime budget'
      : 'Budget';

  function fmtDisplay(v: number) {
    if (isVnd) return v.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' VND';
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
        <div>
          <h2 className="font-semibold text-slate-100">Update {budgetLabel}</h2>
          <p className="text-xs text-slate-400 mt-0.5 truncate">{target.name}</p>
          <div className="flex items-center gap-1.5 mt-1">
            {target.entity_type === 'adset' && (
              <span className="text-xs bg-purple-900/50 text-purple-300 px-1.5 py-0.5 rounded">Ad Set</span>
            )}
            <span className="text-xs bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded font-mono">{target.currency}</span>
          </div>
        </div>

        {currentDisplayBudget !== null && (
          <div className="text-sm text-slate-400">
            Current: <span className="font-medium text-slate-100">{fmtDisplay(currentDisplayBudget)}</span>
          </div>
        )}

        {/* Quick % buttons */}
        <div className="flex gap-2">
          {PCT_BUTTONS.map(({ label, pct, cls }) => (
            <button
              key={pct}
              onClick={() => applyPct(pct)}
              disabled={currentDisplayBudget === null}
              className={`flex-1 py-1.5 text-xs border rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium ${cls}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Absolute input */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            New amount ({target.currency})
          </label>
          <div className="relative">
            {!isVnd && (
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
            )}
            <input
              type="number"
              min={isVnd ? '1000' : '1'}
              step={isVnd ? '1000' : '0.01'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={`w-full ${!isVnd ? 'pl-7' : 'pl-3'} pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500`}
              placeholder={isVnd ? '0' : '0.00'}
            />
            {isVnd && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">VND</span>
            )}
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2 text-sm border border-slate-700 text-slate-300 rounded-lg hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!value || isNaN(parseFloat(value)) || parseFloat(value) <= 0}
            className="flex-1 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            Update
          </button>
        </div>
      </div>
    </div>
  );
}
