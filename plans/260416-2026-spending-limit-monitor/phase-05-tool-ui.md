# Phase 05 — Tool UI (page + client component)

## Context Links
- Server-page pattern: `app/dashboard/page.tsx`
- Client-hub pattern: `app/dashboard/components/campaign-hub.tsx`
- Tool Hub source: `app/tools/page.tsx`
- Routes consumed: `GET /api/spending-limits`, `PATCH /api/spending-limits/[accountId]` (phase 03)

## Overview
- **Priority:** P1 (depends on phase 03)
- **Status:** completed
- **Description:** Server route `app/spending-limit-monitor/page.tsx` validates auth and renders client component `SpendingLimitHub` that lists, refreshes, and edits per-account thresholds.

## Key Insights
- Mirror `dashboard/page.tsx` server-side flow (auth → role → render client component) for consistency.
- All live data fetching happens client-side via `/api/spending-limits` (matches campaigns flow). Server only checks login.
- Inline threshold editing → small dedicated `ThresholdCell` component (debounced is overkill; save on blur/Enter is enough — KISS).
- `setInterval` for auto-refresh (1h). Use `useRef` to hold timer; clear on unmount; reset on manual refresh so countdown matches.
- Countdown UI: derived from `lastFetchedAt` + 60-min interval, ticked by a separate 1s `setInterval`.
- Status badge logic (pure function): Alert (red) if `remaining < threshold`; Warning (amber) if `percent_used >= 75`; OK (green) otherwise; "—" if no cap.

## Requirements
- Table columns: Account Name | Currency | Spending Cap | Amount Spent | Remaining | % Used (progress bar) | Alert Threshold | Status.
- Refresh button (top-right) with loading spinner.
- Last updated timestamp + "Next refresh in Xm Ys".
- Alert threshold editable inline per row; save on blur/Enter; revert on Esc.
- Empty input on save → sets threshold to `null` (disables alerting).
- Status badge with color coding.
- Back link to `/tools`.

## Architecture
```
app/spending-limit-monitor/
  ├── page.tsx                              [server, ~30 lines]
  │     └── auth check → render <SpendingLimitHub userEmail=... />
  └── components/
        ├── spending-limit-hub.tsx          [client, ~180 lines]
        │     ├── state: rows[], loading, error, lastFetchedAt, now
        │     ├── effects: initial fetch, 1h refresh interval, 1s tick
        │     ├── handlers: refresh, saveThreshold(accountId, value)
        │     └── renders: header + table + ThresholdCell per row
        └── threshold-cell.tsx              [client, ~60 lines]
              ├── controlled local state
              ├── onBlur/onKeyDown(Enter|Escape)
              └── async parent.onSave(value)
```

## Related Code Files
**Create:**
- `app/spending-limit-monitor/page.tsx`
- `app/spending-limit-monitor/components/spending-limit-hub.tsx`
- `app/spending-limit-monitor/components/threshold-cell.tsx`

**Modify:** none in this phase.

## Implementation Steps

### 1. `app/spending-limit-monitor/page.tsx` (server)
```typescript
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import SpendingLimitHub from './components/spending-limit-hub';

export default async function SpendingLimitMonitorPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return <SpendingLimitHub userEmail={user.email ?? ''} />;
}
```

### 2. `app/spending-limit-monitor/components/spending-limit-hub.tsx` (client)
```typescript
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, RefreshCw, Wallet } from 'lucide-react';
import ThresholdCell from './threshold-cell';

interface AccountRow {
  account_id: string;
  name: string;
  currency: string;
  spend_cap: number | null;
  amount_spent: number;
  remaining: number | null;
  percent_used: number | null;
  alert_threshold: number | null;
  alert_sent: boolean;
  error?: string;
}

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;  // 1h

function formatAmount(amount: number | null, currency: string): string {
  if (amount === null) return '—';
  // FB stores USD in cents; other currencies (VND) as-is.
  const value = currency === 'USD' ? amount / 100 : amount;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'USD' ? 2 : 0,
  }).format(value);
}

function statusFor(row: AccountRow): { label: string; color: string } {
  if (row.error) return { label: 'Error', color: 'bg-red-100 text-red-700' };
  if (row.spend_cap === null) return { label: 'No Cap', color: 'bg-slate-100 text-slate-600' };
  if (row.alert_threshold !== null && row.remaining !== null && row.remaining < row.alert_threshold) {
    return { label: 'Alert', color: 'bg-red-100 text-red-700' };
  }
  if ((row.percent_used ?? 0) >= 75) return { label: 'Warning', color: 'bg-amber-100 text-amber-700' };
  return { label: 'OK', color: 'bg-emerald-100 text-emerald-700' };
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'refreshing...';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${s}s`;
}

export default function SpendingLimitHub({ userEmail }: { userEmail: string }) {
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastFetchedAt, setLastFetchedAt] = useState<number>(0);
  const [now, setNow] = useState<number>(Date.now());
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/spending-limits', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Fetch failed');
      setRows(json.accounts as AccountRow[]);
      setLastFetchedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + 1h auto-refresh
  useEffect(() => {
    void fetchData();
    refreshTimer.current = setInterval(() => { void fetchData(); }, REFRESH_INTERVAL_MS);
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, [fetchData]);

  // 1s ticker for countdown
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const handleManualRefresh = useCallback(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    refreshTimer.current = setInterval(() => { void fetchData(); }, REFRESH_INTERVAL_MS);
    void fetchData();
  }, [fetchData]);

  const handleSaveThreshold = useCallback(async (accountId: string, value: number | null) => {
    const res = await fetch(`/api/spending-limits/${accountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alert_threshold: value }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Save failed');
    // Optimistic local update + reset alert_sent flag locally
    setRows((prev) =>
      prev.map((r) =>
        r.account_id === accountId ? { ...r, alert_threshold: value, alert_sent: false } : r,
      ),
    );
  }, []);

  const nextRefreshIn = lastFetchedAt ? REFRESH_INTERVAL_MS - (now - lastFetchedAt) : 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="px-8 py-5 border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <Link href="/tools" className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1">
              <ChevronLeft className="w-3 h-3" /> Tools
            </Link>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2 mt-1">
              <Wallet className="w-6 h-6 text-indigo-500" /> Spending Limit Monitor
            </h1>
            <p className="text-slate-500 text-sm mt-0.5">{userEmail}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-500 text-right">
              {lastFetchedAt ? <>Updated {new Date(lastFetchedAt).toLocaleTimeString()}<br />Next in {formatCountdown(nextRefreshIn)}</> : 'Loading...'}
            </div>
            <button
              onClick={handleManualRefresh}
              disabled={loading}
              className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 py-8">
        {error && (
          <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Currency</th>
                <th className="px-4 py-3 text-right">Spend Cap</th>
                <th className="px-4 py-3 text-right">Spent</th>
                <th className="px-4 py-3 text-right">Remaining</th>
                <th className="px-4 py-3">% Used</th>
                <th className="px-4 py-3">Alert Threshold</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No selected accounts. Configure in Settings.</td></tr>
              )}
              {rows.map((row) => {
                const status = statusFor(row);
                const pct = row.percent_used ?? 0;
                const barColor = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-emerald-500';
                return (
                  <tr key={row.account_id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-900">{row.name}<div className="text-xs text-slate-400">{row.account_id}</div></td>
                    <td className="px-4 py-3">{row.currency}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatAmount(row.spend_cap, row.currency)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatAmount(row.amount_spent, row.currency)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatAmount(row.remaining, row.currency)}</td>
                    <td className="px-4 py-3">
                      {row.percent_used === null ? '—' : (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden min-w-[60px]">
                            <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
                          </div>
                          <span className="text-xs text-slate-600 tabular-nums w-10 text-right">{pct.toFixed(0)}%</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ThresholdCell
                        accountId={row.account_id}
                        currency={row.currency}
                        initialValue={row.alert_threshold}
                        onSave={handleSaveThreshold}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${status.color}`}>{status.label}</span>
                      {row.error && <div className="text-xs text-red-500 mt-1">{row.error}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
```

### 3. `app/spending-limit-monitor/components/threshold-cell.tsx` (client)
```typescript
'use client';

import { useEffect, useState } from 'react';

interface Props {
  accountId: string;
  currency: string;
  initialValue: number | null;
  onSave: (accountId: string, value: number | null) => Promise<void>;
}

export default function ThresholdCell({ accountId, currency, initialValue, onSave }: Props) {
  const [value, setValue] = useState<string>(initialValue === null ? '' : String(initialValue));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Re-sync if parent reloads data
  useEffect(() => {
    setValue(initialValue === null ? '' : String(initialValue));
  }, [initialValue]);

  const commit = async () => {
    setError('');
    const trimmed = value.trim();
    const next: number | null = trimmed === '' ? null : Number(trimmed);
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      setError('Invalid number');
      return;
    }
    if (next === initialValue) return; // no-op
    setSaving(true);
    try {
      await onSave(accountId, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setValue(initialValue === null ? '' : String(initialValue));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col">
      <input
        type="text"
        inputMode="decimal"
        value={value}
        disabled={saving}
        placeholder={`disabled (${currency})`}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setValue(initialValue === null ? '' : String(initialValue));
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="w-32 px-2 py-1 border border-slate-200 rounded-md text-sm tabular-nums focus:border-indigo-400 focus:outline-none disabled:opacity-50"
      />
      {error && <span className="text-xs text-red-500 mt-1">{error}</span>}
    </div>
  );
}
```

## Todo List
- [x] Create `app/spending-limit-monitor/page.tsx`
- [x] Create `app/spending-limit-monitor/components/spending-limit-hub.tsx`
- [x] Create `app/spending-limit-monitor/components/threshold-cell.tsx`
- [x] `npx tsc --noEmit` passes
- [x] Run `npm run dev` and visit `/spending-limit-monitor`
- [x] Verify table populates, refresh works, threshold edit persists across reload, status badges color correctly
- [x] Confirm no two files exceed 200 lines (split further if needed)

## Success Criteria
- Page renders without console errors.
- Refresh button shows spinner; `lastFetchedAt` advances.
- Countdown ticks every second.
- Inline edit: type → blur → row updates → reload page → value still there.
- Esc reverts edit; Enter commits.
- Status badge transitions: empty threshold → "OK / Warning / No Cap"; threshold above remaining → "Alert".

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| File grows past 200 lines | Med | Low | `spending-limit-hub.tsx` is borderline; consider extracting `<TableRow>` if > 200 |
| User enters dollars instead of cents for USD | High | Med | Placeholder shows currency; helper text on first row could clarify (defer to v2 unless user requests) |
| Browser tab in background → setInterval throttled | High | Low | Throttling delays the 1h refresh slightly; acceptable. Cron handles the gap. |
| Race: rapid blur on multiple cells overlaps PATCH calls | Low | Low | Each PATCH is per-account-id, no shared state — safe |

## Security Considerations
- Server `page.tsx` enforces login.
- All write paths go through PATCH (auth-checked).
- No FB token exposed to client.

## Next Steps
- Phase 06 adds the tool card so users can navigate here.
