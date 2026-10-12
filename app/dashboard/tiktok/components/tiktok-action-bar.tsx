/**
 * Selection action bar shared by campaign and ad-group views — mirrors FB's action-bar.tsx
 * (ENABLE/DISABLE mapping; budget editing via the comparative TikTok budget modal for 1+ items) but generalized over `entityType` since TikTok
 * needs bulk on/off at both levels, unlike FB's ad-set view which only has inline budget edit.
 * No Duplicate button — deferred to Plan 2.
 */

'use client';

import { useState } from 'react';
import type { SnapshotComparison } from '@/lib/types';
import TiktokBulkBudgetModal from './tiktok-bulk-budget-modal';
import type { TiktokItemMetrics } from './tiktok-budget-metrics';

export interface TiktokActionItem {
  id: string;
  name: string;
  status: string;
  budget: number;
  budget_mode: string;
  advertiser_id: string;
  currency: string;
  /** Live metrics shown in the budget modal's "Current" version. */
  metrics?: TiktokItemMetrics;
}

interface Props {
  entityType: 'campaign' | 'adgroup';
  items: TiktokActionItem[];
  /** Campaign-level snapshots for the budget modal; [] for ad groups. */
  snapshotComparisons: SnapshotComparison[];
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

export default function TiktokActionBar({ entityType, items, snapshotComparisons, onActionComplete, onDeselect }: Props) {
  const [actionState, setActionState] = useState<ActionState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [bulkBudgetOpen, setBulkBudgetOpen] = useState(false);

  const count = items.length;
  const label = entityType === 'campaign' ? 'campaign' : 'ad group';
  const anyEnabled = items.some((i) => i.status === 'ENABLE');
  const allDisabled = items.every((i) => i.status !== 'ENABLE');

  async function handleBulkStatus(action: 'pause' | 'enable') {
    setActionState('loading');
    setErrorMsg('');
    const results: Array<{ name: string; ok: boolean; error?: string }> = [];
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
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      // No auto-refetch on failure: it unmounts this bar and wipes the error before it's read.
      // The user refreshes via "Refresh" (partial successes did change state).
      const reasons = [...new Set(failed.map((f) => f.error))].join(' | ');
      setErrorMsg(`${failed.length} of ${results.length} failed to ${action}: ${reasons}`);
      setActionState('error');
    } else {
      setActionState('done');
      setTimeout(() => { setActionState('idle'); onActionComplete(); }, 800);
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
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setBulkBudgetOpen(true)}
              disabled={actionState === 'loading'}
              className="px-4 py-1.5 text-sm bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors"
            >
              Update budget
            </button>
          </div>
        </div>

        {actionState === 'loading' && <span className="text-sm text-slate-400 ml-2">Applying…</span>}
        {actionState === 'done' && <span className="text-sm text-emerald-600 ml-2">Done</span>}
        {actionState === 'error' && (
          <span className="text-sm text-red-600 ml-2">
            {errorMsg} <button onClick={onActionComplete} className="underline text-red-700 ml-1">Refresh</button>
          </span>
        )}

        <button onClick={onDeselect} className="ml-auto text-xs text-slate-400 hover:text-slate-700">Deselect all</button>
      </div>

      {bulkBudgetOpen && (
        <TiktokBulkBudgetModal
          entityType={entityType}
          items={items}
          concurrency={BULK_CONCURRENCY}
          snapshotComparisons={snapshotComparisons}
          applyBudget={(item, amount) => patchEntity(entityType, item.id, item.advertiser_id, { action: 'budget', amount })}
          onClose={() => setBulkBudgetOpen(false)}
          onApplied={onActionComplete}
        />
      )}
    </>
  );
}
