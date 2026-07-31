'use client';

import { useEffect, useState } from 'react';

/** Rendered only for admin/leader roles — gating happens in the parent (app/settings/page.tsx). */
export default function AdsLaunchTokenCard() {
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [grantedScopes, setGrantedScopes] = useState<string[]>([]);
  const [missingScopes, setMissingScopes] = useState<string[]>([]);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');

  async function loadStatus() {
    const res = await fetch('/api/afs-niche-testing/launch-token');
    const data = await res.json();
    setHasToken(!!data.has_token);
    setGrantedScopes(Array.isArray(data.granted_scopes) ? data.granted_scopes : []);
    setMissingScopes(Array.isArray(data.missing_scopes) ? data.missing_scopes : []);
    setVerifiedAt(data.verified_at ?? null);
  }

  useEffect(() => {
    loadStatus().catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (!token.trim()) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/afs-niche-testing/launch-token', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to save launch token');
      setHasToken(true);
      setGrantedScopes(data.granted_scopes ?? []);
      setMissingScopes(data.missing_scopes ?? []);
      setVerifiedAt(new Date().toISOString());
      setToken('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save launch token');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    const confirmed = window.confirm('Remove the ads-launching token? Publishing new batches will fail until a new one is added.');
    if (!confirmed) return;
    setRemoving(true);
    try {
      const res = await fetch('/api/afs-niche-testing/launch-token', { method: 'DELETE' });
      if (res.ok) {
        setHasToken(false);
        setGrantedScopes([]);
        setMissingScopes([]);
        setVerifiedAt(null);
      }
    } finally {
      setRemoving(false);
    }
  }

  if (loading) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
      <div>
        <h2 className="font-semibold text-slate-900">Ads-Launching Token</h2>
        <p className="text-xs text-slate-500 mt-1">
          A separate Facebook token used only to create Pages/Pixels-backed campaigns for AFS Niche Testing.
          Kept distinct from the read-only dashboard token above.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {hasToken && (
        <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-emerald-600 text-sm">✓</span>
            <span className="text-sm text-emerald-800 font-medium">
              Token configured{verifiedAt ? ` · verified ${new Date(verifiedAt).toLocaleString()}` : ''}
            </span>
          </div>
          <button onClick={handleRemove} disabled={removing} className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50">
            {removing ? 'Removing…' : 'Remove'}
          </button>
        </div>
      )}

      {hasToken && grantedScopes.length > 0 && (
        <p className="text-xs text-slate-500">Granted: {grantedScopes.join(', ')}</p>
      )}

      {hasToken && missingScopes.length > 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Missing scope(s): {missingScopes.join(', ')} — some features (e.g. Page selection) will not work until re-verified with all four permissions.
        </p>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          {hasToken ? 'Replace token' : 'User Access Token'}
        </label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="EAAxxxxxx…"
        />
      </div>
      <button
        onClick={handleSave}
        disabled={saving || !token.trim()}
        className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {saving ? 'Verifying…' : 'Verify & Save Launch Token'}
      </button>
    </div>
  );
}
