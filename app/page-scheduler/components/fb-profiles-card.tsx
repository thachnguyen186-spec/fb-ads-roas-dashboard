'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PsProfile } from '@/lib/page-scheduler/types';

type ProfileRow = Omit<PsProfile, 'user_id'> & { pages_count: number };

interface Props {
  onChanged: () => void;
}

const EXPIRY_WARN_MS = 7 * 24 * 3600 * 1000;

export default function FbProfilesCard({ onChanged }: Props) {
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<string[]>([]);

  const load = useCallback(async () => {
    const res = await fetch('/api/page-scheduler/profiles');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Failed to load profiles');
    setProfiles(data.profiles ?? []);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load')).finally(() => setLoading(false));
  }, [load]);

  async function add() {
    if (!token.trim()) return;
    setAdding(true);
    setError('');
    setNotes([]);
    try {
      const res = await fetch('/api/page-scheduler/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to add token');
      setToken('');
      setNotes(summarize(data));
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add token');
    } finally {
      setAdding(false);
    }
  }

  async function resync(id: string) {
    setBusyId(id);
    setError('');
    setNotes([]);
    try {
      const res = await fetch(`/api/page-scheduler/profiles/${id}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Resync failed');
      setNotes(summarize(data));
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resync failed');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(p: ProfileRow) {
    if (!window.confirm(`Remove "${p.fb_user_name || p.fb_user_id}" and its Pages from the scheduler? Already scheduled posts stay on Facebook.`)) return;
    setBusyId(p.id);
    setError('');
    try {
      const res = await fetch(`/api/page-scheduler/profiles/${p.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Remove failed');
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
      <div>
        <h2 className="font-semibold text-slate-900">Facebook profiles</h2>
        <p className="text-xs text-slate-500 mt-1">
          Paste a User or System User access token (needs pages_show_list, pages_manage_posts, pages_read_engagement; read_insights
          for analytics). System users only see Pages assigned to them: in Business Settings add the Pages as assets of the system user (Create content access). User tokens must come from your Meta app
          and the profile needs an admin/developer/tester role on it. Tokens are encrypted and never shown again.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {notes.map((n) => (
        <p key={n} className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{n}</p>
      ))}

      {!loading && profiles.length === 0 && (
        <p className="text-sm text-slate-500">No profiles yet. Add a token to connect your Pages, then upload a schedule file.</p>
      )}
      <div className="space-y-2">
        {profiles.map((p) => {
          const expMs = p.expires_at ? new Date(p.expires_at).getTime() - Date.now() : null;
          const expiring = expMs !== null && expMs < EXPIRY_WARN_MS;
          const missingInsights = !p.granted_scopes.includes('read_insights');
          return (
            <div key={p.id} className="border border-slate-200 rounded-lg p-3 space-y-1">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-slate-900">{p.fb_user_name || p.fb_user_id}</span>
                  <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{p.token_type}</span>
                  <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${p.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {p.status}
                  </span>
                  <span className="ml-2 text-xs text-slate-500">{p.pages_count} Pages</span>
                </div>
                <div className="flex gap-3 shrink-0">
                  <button onClick={() => resync(p.id)} disabled={busyId === p.id} className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50">
                    {busyId === p.id ? 'Working…' : 'Resync'}
                  </button>
                  <button onClick={() => remove(p)} disabled={busyId === p.id} className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50">
                    Remove
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Expires: {p.expires_at ? new Date(p.expires_at).toLocaleDateString() : 'Never'}
                {p.synced_at ? ` · synced ${new Date(p.synced_at).toLocaleString()}` : ''}
              </p>
              {p.status === 'invalid' && (
                <p className="text-xs text-red-600">Token is invalid{p.last_error ? ` — ${p.last_error}` : ''}. Paste a fresh token to restore it.</p>
              )}
              {expiring && p.token_type === 'USER' && (
                <p className="text-xs text-amber-700">Token expires soon — re-paste to keep resync working (existing Page tokens keep working).</p>
              )}
              {missingInsights && <p className="text-xs text-amber-700">Missing read_insights — analytics will be limited.</p>}
            </div>
          );
        })}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Add access token</label>
        <textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          rows={2}
          autoComplete="off"
          spellCheck={false}
          style={{ WebkitTextSecurity: 'disc' } as React.CSSProperties}
          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="EAAxxxxxx…"
        />
      </div>
      <button
        onClick={add}
        disabled={adding || !token.trim()}
        className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {adding ? 'Verifying & syncing…' : 'Verify & add profile'}
      </button>
    </div>
  );
}

interface SyncPayload {
  pages_total?: number;
  pages_added?: number;
  sync_error?: string;
  hint?: string;
  warnings?: string[];
  missing_optional_scopes?: string[];
}

/** Turns an add/resync response into user-visible notes (warnings, hint, sync error). */
function summarize(d: SyncPayload): string[] {
  const out: string[] = [...(d.warnings ?? [])];
  if (d.sync_error) out.push(`Page sync failed: ${d.sync_error}`);
  else if (d.hint) out.push(d.hint);
  else if (typeof d.pages_total === 'number') out.push(`Synced ${d.pages_total} Pages (${d.pages_added ?? 0} new).`);
  if (d.missing_optional_scopes?.length) out.push(`Missing optional permission(s): ${d.missing_optional_scopes.join(', ')}.`);
  return out;
}
