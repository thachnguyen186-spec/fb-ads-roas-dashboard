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

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/** Convert FB-native unit to human-readable string. USD stored as cents. */
function formatAmount(amount: number | null, currency: string): string {
  if (amount === null) return '—';
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
  if (ms <= 0) return 'refreshing…';
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
      const json = await res.json() as { accounts?: AccountRow[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Fetch failed');
      setRows(json.accounts ?? []);
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

  // 1s ticker for countdown display
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const handleManualRefresh = useCallback(() => {
    // Reset the auto-refresh timer so countdown restarts from 1h
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
    const json = await res.json() as { error?: string };
    if (!res.ok) throw new Error(json.error ?? 'Save failed');
    // Optimistic local update
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
              {lastFetchedAt ? (
                <>
                  Updated {new Date(lastFetchedAt).toLocaleTimeString()}
                  <br />
                  Next in {formatCountdown(nextRefreshIn)}
                </>
              ) : 'Loading…'}
            </div>
            <button
              onClick={handleManualRefresh}
              disabled={loading}
              className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-2 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 py-8">
        {error && (
          <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
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
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    No selected accounts. Configure in Settings.
                  </td>
                </tr>
              )}
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400 italic">
                    Loading…
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const status = statusFor(row);
                const pct = row.percent_used ?? 0;
                const barColor = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-emerald-500';
                return (
                  <tr key={row.account_id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {row.name}
                      <div className="text-xs text-slate-400 font-mono">{row.account_id}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.currency}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {formatAmount(row.spend_cap, row.currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {formatAmount(row.amount_spent, row.currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-900">
                      {formatAmount(row.remaining, row.currency)}
                    </td>
                    <td className="px-4 py-3">
                      {row.percent_used === null ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden min-w-[60px]">
                            <div
                              className={`h-full ${barColor} transition-all`}
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-600 tabular-nums w-10 text-right">
                            {pct.toFixed(0)}%
                          </span>
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
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${status.color}`}>
                        {status.label}
                      </span>
                      {row.error && (
                        <div className="text-xs text-red-500 mt-1 max-w-[160px] truncate" title={row.error}>
                          {row.error}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-slate-400">
          Threshold values are stored in the account's native currency unit
          (USD: cents · VND: đ). Auto-refreshes every hour. Telegram alert fires once
          per threshold crossing.
        </p>
      </main>
    </div>
  );
}
