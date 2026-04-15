'use client';

import { useState } from 'react';
import type { BudgetTarget, MergedCampaign } from '@/lib/types';
import BudgetModal from './budget-modal';

interface Props {
  selectedCampaigns: MergedCampaign[];
  onActionComplete: () => void;
  onDeselect: () => void;
  vndRate: number;
}

type ActionState = 'idle' | 'loading' | 'done' | 'error';

export default function ActionBar({ selectedCampaigns, onActionComplete, onDeselect, vndRate }: Props) {
  const [actionState, setActionState] = useState<ActionState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [budgetTarget, setBudgetTarget] = useState<BudgetTarget | null>(null);

  const count = selectedCampaigns.length;
  const singleCampaign = count === 1 ? selectedCampaigns[0] : null;
  const hasBudget = singleCampaign
    ? singleCampaign.budget_type !== 'unknown'
    : selectedCampaigns.every((c) => c.budget_type !== 'unknown');

  async function runAction(fn: () => Promise<void>) {
    setActionState('loading');
    setErrorMsg('');
    try {
      await fn();
      setActionState('done');
      setTimeout(() => {
        setActionState('idle');
        onActionComplete();
      }, 800);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Action failed');
      setActionState('error');
    }
  }

  async function handlePause() {
    await runAction(async () => {
      await Promise.all(
        selectedCampaigns.map((c) =>
          fetch(`/api/campaigns/${c.campaign_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'pause' }),
          }).then(async (r) => {
            const data = await r.json();
            if (!r.ok) throw new Error(data.error ?? 'Pause failed');
          }),
        ),
      );
    });
  }

  async function handleBudgetConfirm(amount: number, currency: string) {
    if (!budgetTarget) return;
    setBudgetTarget(null);
    await runAction(async () => {
      const res = await fetch(`/api/campaigns/${budgetTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'budget',
          budget_type: budgetTarget.budget_type,
          amount,
          currency,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Budget update failed');
    });
  }

  return (
    <>
      <div className="sticky bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-3 flex items-center gap-3 shadow-md">
        <span className="text-sm font-medium text-slate-700">
          {count} campaign{count !== 1 ? 's' : ''} selected
        </span>

        <div className="flex items-center gap-2 ml-2">
          {/* Pause */}
          <button
            onClick={handlePause}
            disabled={actionState === 'loading'}
            className="px-4 py-1.5 text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
          >
            Pause
          </button>

          {/* Update budget — single campaign only (budget type must be known) */}
          {singleCampaign && hasBudget && (
            <button
              onClick={() => setBudgetTarget({
              id: singleCampaign.campaign_id,
              name: singleCampaign.campaign_name,
              budget_type: singleCampaign.budget_type,
              daily_budget: singleCampaign.daily_budget,
              lifetime_budget: singleCampaign.lifetime_budget,
              entity_type: 'campaign',
              currency: singleCampaign.currency,
              vndRate,
            })}
              disabled={actionState === 'loading'}
              className="px-4 py-1.5 text-sm bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors"
            >
              Update budget
            </button>
          )}
        </div>

        {actionState === 'loading' && (
          <span className="text-sm text-slate-400 ml-2">Applying…</span>
        )}
        {actionState === 'done' && (
          <span className="text-sm text-emerald-600 ml-2">Done</span>
        )}
        {actionState === 'error' && (
          <span className="text-sm text-red-600 ml-2">{errorMsg}</span>
        )}

        <button
          onClick={onDeselect}
          className="ml-auto text-xs text-slate-400 hover:text-slate-700"
        >
          Deselect all
        </button>
      </div>

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
