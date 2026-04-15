'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import type { FbAdAccount } from '@/lib/types';

export default function SettingsPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [accounts, setAccounts] = useState<FbAdAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        if (data.fb_access_token) setToken(data.fb_access_token);
        if (Array.isArray(data.accounts) && data.accounts.length > 0) {
          setAccounts(data.accounts);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleFetchAccounts() {
    if (!token.trim()) return;
    setFetching(true);
    setFetchError('');
    try {
      const res = await fetch(`/api/settings/accounts?token=${encodeURIComponent(token.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to fetch accounts');
      const fetched = (data.accounts as FbAdAccount[]).map((a) => {
        const existing = accounts.find((s) => s.account_id === a.account_id);
        return { ...a, is_selected: existing?.is_selected ?? true };
      });
      setAccounts(fetched);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch accounts');
    } finally {
      setFetching(false);
    }
  }

  function toggleAccount(accountId: string) {
    setAccounts((prev) =>
      prev.map((a) => (a.account_id === accountId ? { ...a, is_selected: !a.is_selected } : a)),
    );
  }

  async function handleRemoveAccount(accountId: string) {
    try {
      await fetch(`/api/settings/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
    } catch {}
    setAccounts((prev) => prev.filter((a) => a.account_id !== accountId));
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg('');
    setSaveError('');
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fb_access_token: token || null, accounts }),
    });
    const data = await res.json();
    if (!res.ok) {
      setSaveError(data.error ?? 'Failed to save');
    } else {
      setSaveMsg('Settings saved.');
    }
    setSaving(false);
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const statusLabel = (s: number | null) => {
    if (s === 1) return { text: 'Active', cls: 'bg-emerald-900/50 text-emerald-400' };
    if (s === 2) return { text: 'Disabled', cls: 'bg-red-900/50 text-red-400' };
    return { text: 'Unknown', cls: 'bg-slate-700 text-slate-400' };
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-sm text-slate-400 hover:text-slate-200">← Dashboard</Link>
          <span className="text-sm font-semibold text-slate-100">Settings</span>
        </div>
        <button onClick={handleSignOut} className="text-sm text-slate-400 hover:text-slate-200">Sign out</button>
      </header>

      <main className="max-w-xl mx-auto px-6 py-10 space-y-6">
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <>
            {/* Token section */}
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 space-y-4">
              <div>
                <h2 className="font-semibold text-slate-100">Facebook Access Token</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Generate a User Access Token from{' '}
                  <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" className="text-indigo-400 underline hover:text-indigo-300">
                    Graph API Explorer
                  </a>{' '}
                  with <code className="bg-slate-800 text-slate-300 px-1 rounded">ads_management</code> and{' '}
                  <code className="bg-slate-800 text-slate-300 px-1 rounded">ads_read</code> permissions.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">User Access Token</label>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="EAAxxxxxx…"
                />
              </div>
              <button
                onClick={handleFetchAccounts}
                disabled={fetching || !token.trim()}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {fetching ? 'Fetching…' : 'Fetch Ad Accounts'}
              </button>
              {fetchError && <p className="text-sm text-red-400">{fetchError}</p>}
            </div>

            {/* Accounts list */}
            {accounts.length > 0 && (
              <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 space-y-3">
                <h2 className="font-semibold text-slate-100">Connected Ad Accounts</h2>
                <p className="text-xs text-slate-400">Check the accounts you want to use in the dashboard.</p>
                <ul className="divide-y divide-slate-800">
                  {accounts.map((a) => {
                    const badge = statusLabel(a.account_status ?? null);
                    return (
                      <li key={a.account_id} className="flex items-center gap-3 py-3">
                        <input
                          type="checkbox"
                          id={a.account_id}
                          checked={a.is_selected}
                          onChange={() => toggleAccount(a.account_id)}
                          className="h-4 w-4 rounded border-slate-600 text-indigo-600 focus:ring-indigo-500 bg-slate-800"
                        />
                        <label htmlFor={a.account_id} className="flex-1 min-w-0 cursor-pointer">
                          <span className="block text-sm font-medium text-slate-100 truncate">{a.name}</span>
                          <span className="block text-xs text-slate-500 font-mono">{a.account_id}</span>
                        </label>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                          {badge.text}
                        </span>
                        {a.currency && a.currency !== 'USD' && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-900/50 text-orange-300">
                            {a.currency}
                          </span>
                        )}
                        <button
                          onClick={() => handleRemoveAccount(a.account_id)}
                          className="text-slate-600 hover:text-red-400 transition-colors text-sm ml-1"
                          title="Remove account"
                        >
                          ✕
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Save */}
            <div className="space-y-2">
              {saveError && <p className="text-sm text-red-400">{saveError}</p>}
              {saveMsg && <p className="text-sm text-emerald-400">{saveMsg}</p>}
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
