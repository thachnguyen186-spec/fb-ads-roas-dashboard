'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatBangkok } from '@/lib/page-scheduler/schedule-time';
import BatchDetail from './batch-detail';
import { STATUS_STYLE } from './batch-posts-table';
import type { TabProps } from './page-scheduler-hub';

interface BatchRow {
  id: string;
  file_name: string;
  status: string;
  row_count: number;
  created_at: string;
  counts: Record<string, number>;
  owner_email: string | null;
  is_owner: boolean;
}

export default function QueueTab({ role, onNavigate }: TabProps) {
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [owner, setOwner] = useState('all');
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const canFilter = role === 'admin' || role === 'leader';

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/page-scheduler/batches?owner=${encodeURIComponent(owner)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setBatches(d.batches ?? []);
      setOwners(d.owners ?? {});
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load batches');
    } finally {
      setLoading(false);
    }
  }, [owner]);

  useEffect(() => { void load(); }, [load]);

  if (selected) return <BatchDetail batchId={selected} onBack={() => { setSelected(null); void load(); }} onChanged={load} />;

  const showOwner = canFilter && Object.keys(owners).length > 1;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-slate-900">Batches</h2>
        {showOwner && (
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white">
            <option value="all">All users</option>
            <option value="me">Me</option>
            {Object.entries(owners).map(([id, email]) => <option key={id} value={id}>{email}</option>)}
          </select>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? <p className="text-sm text-slate-500">Loading…</p> : batches.length === 0 ? (
        <p className="text-sm text-slate-500">
          No batches yet — create one in the Upload tab.{' '}
          {onNavigate && <button onClick={() => onNavigate('upload')} className="text-indigo-600 underline">Go to Upload</button>}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {batches.map((b) => (
            <li key={b.id}>
              <button onClick={() => setSelected(b.id)} className="w-full text-left py-3 hover:bg-slate-50 px-2 rounded-lg">
                <div className="flex justify-between gap-2">
                  <span className="font-medium text-slate-800 truncate">{b.file_name || 'Untitled batch'}</span>
                  <span className="text-xs text-slate-500 whitespace-nowrap">{formatBangkok(b.created_at)}</span>
                </div>
                <div className="flex gap-2 flex-wrap mt-1 text-xs items-center">
                  <span className="text-slate-500">{b.row_count} rows</span>
                  {b.status === 'awaiting_media' && <span className="text-amber-700">awaiting images</span>}
                  {Object.entries(b.counts).map(([s, n]) => <span key={s} className={`px-2 py-0.5 rounded-full ${STATUS_STYLE[s] ?? ''}`}>{s} {n}</span>)}
                  {showOwner && b.owner_email && <span className="text-slate-400">· {b.owner_email}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
