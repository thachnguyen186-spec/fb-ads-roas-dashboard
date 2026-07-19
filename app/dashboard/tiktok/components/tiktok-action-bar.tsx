/**
 * Selection action bar shared by campaign and ad-group views — mirrors FB's action-bar.tsx
 * (ENABLE/DISABLE mapping, budget-modal reuse) but generalized over `entityType` since TikTok
 * needs bulk on/off at both levels, unlike FB's ad-set view which only has inline budget edit.
 * No Duplicate button — deferred to Plan 2.
 */

'use client';

import { useState } from 'react';
import { TIKTOK_BUDGET_MODE_DAY, toBudgetTargetType } from '@/lib/tiktok/budget-limits';
import type { BudgetTarget } from '@/lib/types';
import BudgetModal from '@/app/dashboard/components/budget-modal';

export interface TiktokActionItem {
  id: string;
  name: string;
  status: string;
  budget: number;
  budget_mode: string;
  advertiser_id: string;
  currency: string;
}

interface Props {
  entityType: 'campaign' | 'adgroup';
  items: TiktokActionItem[];
  minDailyBudget: number;
  onActionComplete: () => void;
  onDeselect: () => void;
}

type ActionState = 'idle' | 'loading' | 'done' | 'error';

/** Caps burst concurrency against TikTok's shared org-wide credential — same value as the
 * read-side fan-out in campaigns/route.ts. Each PATCH also does its own ownership-check API
 * call server-side, so an unbounded Promise.all here would multiply rate-limit pressure. */
const BULK_CONCURRENCY = 3;

async function patchEntity(entityType: 'campaign' | 'adgroup', id: string, advertiserId: string, body: Record<string, unknown>) {
  const path = entityType === 'campaign' ? `/api/tiktok/campaigns/${id}` : `/api/tiktok/adgroups/${id}`;
  const res = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, advertiser_id: advertiserId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Action failed');
}

export default function TiktokActionBar({ entityType, items, minDailyBudget, onActionComplete, onDeselect }: Props) {
  const [actionState, setActionState] = useState<ActionState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [budgetItem, setBudgetItem] = useState<TiktokActionItem | null>(null);

  const count = items.length;
  const single = count === 1 ? items[0] : null;
  const label = entityType === 'campaign' ? 'campaign' : 'ad group';
  const anyEnabled = items.some((i) => i.status === 'ENABLE');
  const allDisabled = items.every((i) => i.status !== 'ENABLE');

  const budgetTarget: BudgetTarget | null = budgetItem ? (() => {
    const budgetType = toBudgetTargetType(budgetItem.budget_mode);
    return {
      id: budgetItem.id,
      name: budgetItem.name,
      budget_type: budgetType,
      daily_budget: budgetType === 'daily' ? budgetItem.budget : null,
      lifetime_budget: budgetType === 'lifetime' ? budgetItem.budget : null,
      entity_type: entityType === 'campaign' ? 'campaign' : 'adset',
      currency: budgetItem.currency,
      vndRate: 1,
    };
  })() : null;

  async function handleBulkStatus(action: 'pause' | 'enable') {
    setActionState('loading');
    setErrorMsg('');
    const results: Array<{ name: string; ok: boolean }> = [];
    for (let i = 0; i < items.length; i += BULK_CONCURRENCY) {
      const batch = items.slice(i, i + BULK_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((item) =>
          patchEntity(entityType, item.id, item.advertiser_id, { action })
            .then(() => ({ name: item.name, ok: true as const }))
            .catch((err: unknown) => ({ name: item.name, ok: false as const, error: err instanceof Error ? err.message : 'failed' })),
        ),
      );
      results.push(...batchResults);
    }
    // Refetch regardless of outcome — successful items in a partial failure did change state.
    onActionComplete();
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      setErrorMsg(`${failed.length} of ${results.length} failed to ${action}: ${failed.map((f) => f.name).join(', ')}`);
      setActionState('error');
    } else {
      setActionState('done');
      setTimeout(() => setActionState('idle'), 800);
    }
  }

  async function handleBudgetConfirm(amount: number) {
    if (!budgetItem) return;
    const item = budgetItem;
    setBudgetItem(null);
    setActionState('loading');
    setErrorMsg('');
    try {
      await patchEntity(entityType, item.id, item.advertiser_id, { action: 'budget', amount });
      setActionState('done');
      setTimeout(() => { setActionState('idle'); onActionComplete(); }, 800);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Budget update failed');
      setActionState('error');
    }
  }

  return (
    <>
      <div className="sticky bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200 px-6 py-3 flex items-center gap-3 shadow-md">
        <span className="text-sm font-medium text-slate-700">{count} {label}{count !== 1 ? 's' : ''} selected</span>

        <div className="flex items-center gap-2 ml-2">
          {anyEnabled && (
            <button
              onClick={() => handleBulkStatus('pause')}
              disabled={actionState === 'loading'}
              className="px-4 py-1.5 text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
            >
              Pause
            </button>
          )}
          {allDisabled && (
            <button
              onClick={() => handleBulkStatus('enable')}
              disabled={actionState === 'loading'}
              className="px-4 py-1.5 text-sm bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50 transition-colors"
            >
              Turn On
            </button>
          )}
          {single && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setBudgetItem(single)}
                disabled={actionState === 'loading'}
                className="px-4 py-1.5 text-sm bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors"
              >
                Update budget
              </button>
              {single.budget_mode === TIKTOK_BUDGET_MODE_DAY && (
                <span className="text-[10px] text-slate-400">Min ${minDailyBudget}/day</span>
              )}
            </div>
          )}
        </div>

        {actionState === 'loading' && <span className="text-sm text-slate-400 ml-2">Applying…</span>}
        {actionState === 'done' && <span className="text-sm text-emerald-600 ml-2">Done</span>}
        {actionState === 'error' && <span className="text-sm text-red-600 ml-2">{errorMsg}</span>}

        <button onClick={onDeselect} className="ml-auto text-xs text-slate-400 hover:text-slate-700">Deselect all</button>
      </div>

      {budgetTarget && (
        <BudgetModal target={budgetTarget} onConfirm={(amount) => handleBudgetConfirm(amount)} onClose={() => setBudgetItem(null)} />
      )}
    </>
  );
}
