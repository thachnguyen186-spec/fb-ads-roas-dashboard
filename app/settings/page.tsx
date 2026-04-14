'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';

export default function SettingsPage() {
  const router = useRouter();
  const [fbAdAccountId, setFbAdAccountId] = useState('');
  const [fbAccessToken, setFbAccessToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [saveError, setSaveError] = useState('');

  // Load existing credentials on mount
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        if (data.fb_ad_account_id) setFbAdAccountId(data.fb_ad_account_id);
        if (data.fb_access_token) setFbAccessToken(data.fb_access_token);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMsg('');
    setSaveError('');

    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fb_access_token: fbAccessToken || null,
        fb_ad_account_id: fbAdAccountId || null,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setSaveError(data.error ?? 'Failed to save');
    } else {
      setSaveMsg('Saved successfully.');
    }
    setSaving(false);
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">
            ← Dashboard
          </Link>
          <span className="text-sm font-semibold text-gray-900">Settings</span>
        </div>
        <button onClick={handleSignOut} className="text-sm text-gray-500 hover:text-gray-700">
          Sign out
        </button>
      </header>

      <main className="max-w-lg mx-auto px-6 py-10">
        {loading ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : (
          <form onSubmit={handleSave} className="space-y-6">
            <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
              <div>
                <h2 className="font-semibold text-gray-900">Facebook Ads Integration</h2>
                <p className="text-xs text-gray-500 mt-1">
                  Generate a User Access Token from{' '}
                  <a
                    href="https://developers.facebook.com/tools/explorer/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-gray-700"
                  >
                    Graph API Explorer
                  </a>{' '}
                  with <code className="bg-gray-100 px-1 rounded text-xs">ads_management</code> and{' '}
                  <code className="bg-gray-100 px-1 rounded text-xs">ads_read</code> permissions.
                  Tokens expire every 60 days — re-enter when campaigns stop loading.
                </p>
              </div>

              {saveError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                  {saveError}
                </div>
              )}
              {saveMsg && (
                <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
                  {saveMsg}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ad Account ID</label>
                <input
                  type="text"
                  value={fbAdAccountId}
                  onChange={(e) => setFbAdAccountId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="act_123456789"
                />
                <p className="text-xs text-gray-400 mt-1">Format: act_ followed by your numeric account ID</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">User Access Token</label>
                <input
                  type="password"
                  value={fbAccessToken}
                  onChange={(e) => setFbAccessToken(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="EAAxxxxxx…"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
