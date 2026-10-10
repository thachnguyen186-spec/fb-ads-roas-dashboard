'use client';

import { useEffect, useState } from 'react';
import type { UserRole } from '@/lib/types';
import ChangePictureDialog from './change-picture-dialog';

interface PageRow {
  id: string;
  user_id: string;
  page_id: string;
  name: string;
  category: string | null;
  picture_url: string | null;
  tasks: string[];
  is_active: boolean;
  profile_name: string;
  profile_status: string;
  owner_email: string | null;
  is_owner: boolean;
}

interface Props {
  role: UserRole;
  /** Bump to force a refetch (profile added / resynced / removed). */
  version: number;
}

export default function PagesTable({ role, version }: Props) {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [owner, setOwner] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<PageRow | null>(null);
  const canFilter = role === 'admin' || role === 'leader';

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/page-scheduler/pages?owner=${encodeURIComponent(owner)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Failed to load pages');
        if (cancelled) return;
        setPages(data.pages ?? []);
        setOwners(data.owners ?? {});
        setError('');
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load pages'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [owner, version]);

  const showOwner = canFilter && Object.keys(owners).length > 1;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-slate-900">Pages ({pages.filter((p) => p.is_active).length} active)</h2>
        {showOwner && (
          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className="px-2 py-1 border border-slate-300 rounded-lg text-sm text-slate-700 bg-white"
          >
            <option value="all">All visible</option>
            <option value="me">Me</option>
            {Object.entries(owners).map(([id, email]) => (
              <option key={id} value={id}>{email}</option>
            ))}
          </select>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && !error && pages.length === 0 && (
        <p className="text-sm text-slate-500">No Pages yet — add a profile token above.</p>
      )}

      {pages.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-3 font-medium">Page</th>
                <th className="py-2 pr-3 font-medium">Profile</th>
                {showOwner && <th className="py-2 pr-3 font-medium">Owner</th>}
                <th className="py-2 pr-3 font-medium">Permissions</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 font-medium">Picture</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => {
                const canPost = p.tasks.includes('CREATE_CONTENT');
                return (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {p.picture_url && <img src={p.picture_url} alt="" className="w-7 h-7 rounded-full" />}
                        <div>
                          <div className="font-medium text-slate-900">{p.name}</div>
                          <div className="text-xs text-slate-400">{p.page_id}{p.category ? ` · ${p.category}` : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-slate-600">{p.profile_name}</td>
                    {showOwner && <td className="py-2 pr-3 text-slate-600">{p.owner_email ?? '—'}{p.is_owner ? ' (you)' : ''}</td>}
                    <td className="py-2 pr-3">
                      {canPost ? (
                        <span className="text-xs text-emerald-700">Can post</span>
                      ) : (
                        <span className="text-xs text-amber-700">No CREATE_CONTENT — cannot post</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {!p.is_active ? (
                        <span className="text-slate-400">Inactive</span>
                      ) : p.profile_status === 'invalid' ? (
                        <span className="text-red-600">Token invalid</span>
                      ) : (
                        <span className="text-emerald-700">Active</span>
                      )}
                    </td>
                    <td className="py-2 text-xs">
                      {p.is_owner && p.is_active && (
                        <button
                          onClick={() => setEditing(p)}
                          disabled={!p.tasks.includes('MANAGE')}
                          title={p.tasks.includes('MANAGE') ? 'Change profile picture' : 'Needs the MANAGE task (Full control) on this Page'}
                          className="px-2 py-1 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Change picture
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ChangePictureDialog
          pageId={editing.page_id}
          pageName={editing.name}
          onClose={() => setEditing(null)}
          onDone={(url) => {
            const id = editing.id;
            if (url) setPages((prev) => prev.map((p) => (p.id === id ? { ...p, picture_url: url } : p)));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
