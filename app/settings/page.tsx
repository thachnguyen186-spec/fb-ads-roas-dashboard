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
      // Preserve existing is_selected state for accounts already saved
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
    if (s === 1) return { text: 'Active', cls: 'bg-green-100 text-green-700' };
    if (s === 2) return { text: 'Disabled', cls: 'bg-red-100 text-red-700' };
    return { text: 'Unknown', cls: 'bg-gray-100 text-gray-500' };
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">← Dashboard</Link>
          <span className="text-sm font-semibold text-gray-900">Settings</span>
        </div>
        <button onClick={handleSignOut} className="text-sm text-gray-500 hover:text-gray-700">Sign out</button>
      </header>

      <main className="max-w-xl mx-auto px-6 py-10 space-y-6">
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <>
            {/* Token section */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
              <div>
                <h2 className="font-semibold text-gray-900">Facebook Access Token</h2>
                <p className="text-xs text-gray-500 mt-1">
                  Generate a User Access Token from{' '}
                  <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-700">
                    Graph API Explorer
                  </a>{' '}
                  with <code className="bg-gray-100 px-1 rounded">ads_management</code> and{' '}
                  <code className="bg-gray-100 px-1 rounded">ads_read</code> permissions.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">User Access Token</label>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="EAAxxxxxx…"
                />
              </div>
              <button
                onClick={handleFetchAccounts}
                disabled={fetching || !token.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {fetching ? 'Fetching…' : 'Fetch Ad Accounts'}
              </button>
              {fetchError && (
                <p className="text-sm text-red-600">{fetchError}</p>
              )}
            </div>

            {/* Accounts list */}
            {accounts.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-3">
                <h2 className="font-semibold text-gray-900">Connected Ad Accounts</h2>
                <p className="text-xs text-gray-500">Check the accounts you want to use in the dashboard.</p>
                <ul className="divide-y divide-gray-100">
                  {accounts.map((a) => {
                    const badge = statusLabel(a.account_status ?? null);
                    return (
                      <li key={a.account_id} className="flex items-center gap-3 py-3">
                        <input
                          type="checkbox"
                          id={a.account_id}
                          checked={a.is_selected}
                          onChange={() => toggleAccount(a.account_id)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <label htmlFor={a.account_id} className="flex-1 min-w-0 cursor-pointer">
                          <span className="block text-sm font-medium text-gray-900 truncate">{a.name}</span>
                          <span className="block text-xs text-gray-500 font-mono">{a.account_id}</span>
                        </label>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                          {badge.text}
                        </span>
                        <button
                          onClick={() => handleRemoveAccount(a.account_id)}
                          className="text-gray-400 hover:text-red-500 transition-colors text-sm ml-1"
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
              {saveError && (
                <p className="text-sm text-red-600">{saveError}</p>
              )}
              {saveMsg && (
                <p className="text-sm text-green-600">{saveMsg}</p>
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
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
