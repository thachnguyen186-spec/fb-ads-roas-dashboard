'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import type { FbAdAccount } from '@/lib/types';

export default function SettingsPage() {
  const router = useRouter();
  const [token, setToken] = useState('');           // new token input (empty = keep existing)
  const [hasToken, setHasToken] = useState(false);  // whether a token is already saved
  const [removeToken, setRemoveToken] = useState(false); // user explicitly requested removal
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
        setHasToken(!!data.has_token);
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
      // POST to keep token out of URL / server logs
      const res = await fetch('/api/settings/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
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
    const payload: Record<string, unknown> = { accounts };
    if (removeToken) payload.fb_access_token = null;
    else if (token.trim()) payload.fb_access_token = token.trim();
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setSaveError(data.error ?? 'Failed to save');
    } else {
      setSaveMsg('Settings saved.');
      if (token.trim()) { setHasToken(true); setToken(''); }
      if (removeToken) setRemoveToken(false);
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
    if (s === 1) return { text: 'Active', cls: 'bg-emerald-100 text-emerald-700' };
    if (s === 2) return { text: 'Disabled', cls: 'bg-red-100 text-red-700' };
    return { text: 'Unknown', cls: 'bg-slate-100 text-slate-500' };
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-800">← Dashboard</Link>
          <span className="text-sm font-semibold text-slate-900">Settings</span>
        </div>
        <button onClick={handleSignOut} className="text-sm text-slate-500 hover:text-slate-800">Sign out</button>
      </header>

      <main className="max-w-xl mx-auto px-6 py-10 space-y-6">
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <>
            {/* Facebook Access Token */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div>
                <h2 className="font-semibold text-slate-900">Facebook Access Token</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Generate a User Access Token from{' '}
                  <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline hover:text-indigo-700">
                    Graph API Explorer
                  </a>{' '}
                  with <code className="bg-slate-100 text-slate-700 px-1 rounded">ads_management</code> and{' '}
                  <code className="bg-slate-100 text-slate-700 px-1 rounded">ads_read</code> permissions.
                </p>
              </div>
              {hasToken && (
                <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-600 text-sm">✓</span>
                    <span className="text-sm text-emerald-800 font-medium">Token configured</span>
                  </div>
                  <button
                    onClick={() => { setHasToken(false); setRemoveToken(true); setToken(''); }}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {hasToken ? 'Replace token (leave blank to keep existing)' : 'User Access Token'}
                </label>
                <input
                  type="password"
                  value={token === '\x00REMOVE' ? '' : token}
                  onChange={(e) => setToken(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder={hasToken ? '••••••• (paste new token to replace)' : 'EAAxxxxxx…'}
                />
              </div>
              <button
                onClick={handleFetchAccounts}
                disabled={fetching || !token.trim()}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {fetching ? 'Fetching…' : 'Fetch Ad Accounts'}
              </button>
              {fetchError && <p className="text-sm text-red-600">{fetchError}</p>}
            </div>

            {/* Accounts list */}
            {accounts.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
                <h2 className="font-semibold text-slate-900">Connected Ad Accounts</h2>
                <p className="text-xs text-slate-500">Check the accounts you want to use in the dashboard.</p>
                <ul className="divide-y divide-slate-100">
                  {accounts.map((a) => {
                    const badge = statusLabel(a.account_status ?? null);
                    return (
                      <li key={a.account_id} className="flex items-center gap-3 py-3">
                        <input
                          type="checkbox"
                          id={a.account_id}
                          checked={a.is_selected}
                          onChange={() => toggleAccount(a.account_id)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 bg-white"
                        />
                        <label htmlFor={a.account_id} className="flex-1 min-w-0 cursor-pointer">
                          <span className="block text-sm font-medium text-slate-900 truncate">{a.name}</span>
                          <span className="block text-xs text-slate-400 font-mono">{a.account_id}</span>
                        </label>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                          {badge.text}
                        </span>
                        {a.currency && a.currency !== 'USD' && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-700">
                            {a.currency}
                          </span>
                        )}
                        <button
                          onClick={() => handleRemoveAccount(a.account_id)}
                          className="text-slate-300 hover:text-red-500 transition-colors text-sm ml-1"
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
              {saveError && <p className="text-sm text-red-600">{saveError}</p>}
              {saveMsg && <p className="text-sm text-emerald-600">{saveMsg}</p>}
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
