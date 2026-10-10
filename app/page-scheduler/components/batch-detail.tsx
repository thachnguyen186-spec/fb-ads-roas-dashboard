'use client';

import { useCallback, useEffect, useState } from 'react';
import BatchPostsTable, { STATUS_STYLE, type DetailPost } from './batch-posts-table';
import { usePushLoop } from './use-push-loop';

interface Detail {
  batch: { id: string; file_name: string; status: string };
  posts: DetailPost[];
  total: number;
  counts: Record<string, number>;
  pages: { page_id: string; page_name: string }[];
  owner_email: string | null;
  is_owner: boolean;
}

const PAGE_SIZE = 200;
const STATUS_ORDER = Object.keys(STATUS_STYLE);

interface Props {
  batchId: string;
  onBack: () => void;
  /** Called after any change so the batch list counts refresh. */
  onChanged: () => void;
}

export default function BatchDetail({ batchId, onBack, onChanged }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [status, setStatus] = useState('');
  const [pageId, setPageId] = useState('');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ msg: string; link?: string } | null>(null);

  const load = useCallback(async () => {
    const q = new URLSearchParams({ offset: String(offset) });
    if (status) q.set('status', status);
    if (pageId) q.set('page_id', pageId);
    try {
      const r = await fetch(`/api/page-scheduler/batches/${batchId}?${q}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setDetail(d as Detail);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load batch');
    }
  }, [batchId, offset, status, pageId]);

  useEffect(() => { void load(); }, [load]);

  const refresh = useCallback(() => { void load(); onChanged(); }, [load, onChanged]);
  const loop = usePushLoop(batchId, refresh);

  async function batchAction(url: string, method: string, confirmMsg: string) {
    if (!window.confirm(confirmMsg)) return;
    try {
      const r = await fetch(url, { method });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((d as { error?: string }).error ?? `HTTP ${r.status}`);
      if (method === 'DELETE') { onChanged(); onBack(); return; }
      refresh();
    } catch (err) {
      setNotice({ msg: err instanceof Error ? err.message : 'Action failed' });
    }
  }

  const counts = detail?.counts ?? {};
  const unpushed = (counts.draft ?? 0) + (counts.queued ?? 0) + (counts.waiting ?? 0);
  const live = (counts.scheduled ?? 0) + (counts.published ?? 0) + (counts.pushing ?? 0);
  const isOwner = detail?.is_owner ?? false;
  const sel = 'border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white';
  const base = `/api/page-scheduler/batches/${batchId}`;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <button onClick={onBack} className="text-sm text-indigo-600 hover:underline">&larr; All batches</button>
          <h2 className="font-semibold text-slate-900 mt-1">{detail?.batch.file_name ?? 'Batch'}</h2>
          {detail?.owner_email && <p className="text-xs text-slate-500">Owner: {detail.owner_email}{!isOwner && ' (read-only)'}</p>}
        </div>
        {isOwner && (
          <div className="flex gap-2 flex-wrap">
            {loop.running
              ? <button onClick={loop.stop} className="px-3 py-1.5 text-sm rounded-lg bg-amber-500 text-white">Stop</button>
              : <button onClick={() => void loop.start()} disabled={(counts.queued ?? 0) === 0}
                  className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white disabled:opacity-50">
                  {loop.totals.pushed + loop.totals.failed > 0 ? 'Resume push' : 'Push to Facebook'} ({counts.queued ?? 0})
                </button>}
            <button disabled={unpushed === 0 || loop.running} onClick={() => batchAction(`${base}/cancel-unpushed`, 'POST', `Cancel ${unpushed} unpushed post(s)?`)}
              className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 text-slate-700 disabled:opacity-50">Cancel unpushed</button>
            <button disabled={live > 0 || loop.running} title={live > 0 ? 'Cancel scheduled posts first' : ''}
              onClick={() => batchAction(base, 'DELETE', 'Delete this batch and all its posts?')}
              className="px-3 py-1.5 text-sm rounded-lg border border-red-300 text-red-600 disabled:opacity-50">Delete batch</button>
          </div>
        )}
      </div>

      <div className="flex gap-2 flex-wrap text-xs">
        {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
          <span key={s} className={`px-2 py-0.5 rounded-full ${STATUS_STYLE[s]}`}>{s} {counts[s]}</span>
        ))}
      </div>

      {isOwner && <p className="text-xs text-slate-500">Keep this tab open while pushing. Avoid piling many posts onto one Page in a short time (Facebook spam limits).</p>}
      {loop.running && (
        <p className="text-sm text-indigo-700">
          Pushing… {loop.totals.pushed} scheduled, {loop.totals.failed} failed{loop.totals.requeued > 0 && `, ${loop.totals.requeued} retried`}
          {loop.backoffLeft > 0 && ` — rate limited, resuming in ${loop.backoffLeft}s`}
        </p>
      )}
      {loop.halt && <p className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-3">Facebook blocked posting (stopped): {loop.halt}</p>}
      {loop.error && <p className="text-sm text-red-600">{loop.error}</p>}
      {loop.totals.stuck > 0 && <p className="text-sm text-amber-700">{loop.totals.stuck} post(s) could not be saved after pushing and are left in &quot;pushing&quot; — they will be reconciled automatically; do not retry them.</p>}
      {loop.finished && (
        <p className="text-sm bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg p-3">
          Done: {loop.totals.pushed} scheduled{loop.totals.failed > 0 && `, ${loop.totals.failed} failed`}, {loop.totals.waiting} waiting — waiting posts are pushed automatically each hour once within 29 days.
        </p>
      )}
      {notice && (
        <p className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">
          {notice.msg} {notice.link && <a href={notice.link} target="_blank" rel="noreferrer" className="underline">Open Business Suite</a>}
          <button onClick={() => setNotice(null)} className="ml-2 text-xs underline">dismiss</button>
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2 flex-wrap">
        <select className={sel} value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
          <option value="">All statuses</option>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={sel} value={pageId} onChange={(e) => { setPageId(e.target.value); setOffset(0); }}>
          <option value="">All Pages</option>
          {(detail?.pages ?? []).map((p) => <option key={p.page_id} value={p.page_id}>{p.page_name || p.page_id}</option>)}
        </select>
      </div>

      {detail && <BatchPostsTable posts={detail.posts} isOwner={isOwner} ownerEmail={detail.owner_email} onChanged={refresh} onNotice={(msg, link) => setNotice({ msg, link })} />}
      {detail && detail.total > PAGE_SIZE && (
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} className="underline disabled:opacity-40 disabled:no-underline">Prev</button>
          <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, detail.total)} of {detail.total}</span>
          <button disabled={offset + PAGE_SIZE >= detail.total} onClick={() => setOffset(offset + PAGE_SIZE)} className="underline disabled:opacity-40 disabled:no-underline">Next</button>
        </div>
      )}
    </div>
  );
}
