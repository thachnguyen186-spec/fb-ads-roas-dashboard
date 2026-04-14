'use client';

import { useState } from 'react';
import type { MergedCampaign } from '@/lib/types';

interface Props {
  campaign: MergedCampaign;
  onConfirm: (amountUsd: number) => void;
  onClose: () => void;
}

const PCT_BUTTONS = [
  { label: '−50%', pct: -50 },
  { label: '−20%', pct: -20 },
  { label: '+20%', pct: 20 },
  { label: '+50%', pct: 50 },
];

export default function BudgetModal({ campaign, onConfirm, onClose }: Props) {
  const currentBudget =
    campaign.budget_type === 'daily'
      ? campaign.daily_budget
      : campaign.budget_type === 'lifetime'
      ? campaign.lifetime_budget
      : null;

  const [value, setValue] = useState(currentBudget !== null ? String(currentBudget) : '');

  function applyPct(pct: number) {
    if (currentBudget === null) return;
    const next = Math.max(1, Math.round(currentBudget * (1 + pct / 100) * 100) / 100);
    setValue(String(next));
  }

  function handleConfirm() {
    const amt = parseFloat(value);
    if (!isNaN(amt) && amt > 0) onConfirm(amt);
  }

  const budgetLabel =
    campaign.budget_type === 'daily'
      ? 'Daily budget'
      : campaign.budget_type === 'lifetime'
      ? 'Lifetime budget'
      : 'Budget';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-5">
        <div>
          <h2 className="font-semibold text-gray-900">Update {budgetLabel}</h2>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{campaign.campaign_name}</p>
        </div>

        {currentBudget !== null && (
          <div className="text-sm text-gray-500">
            Current: <span className="font-medium text-gray-800">${currentBudget.toFixed(2)}</span>
          </div>
        )}

        {/* Quick % buttons */}
        <div className="flex gap-2">
          {PCT_BUTTONS.map(({ label, pct }) => (
            <button
              key={pct}
              onClick={() => applyPct(pct)}
              disabled={currentBudget === null}
              className="flex-1 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {label}
            </button>
          ))}
        </div>

        {/* Absolute input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">New amount (USD)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
            <input
              type="number"
              min="1"
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0.00"
            />
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!value || isNaN(parseFloat(value)) || parseFloat(value) <= 0}
            className="flex-1 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            Update
          </button>
        </div>
      </div>
    </div>
  );
}
