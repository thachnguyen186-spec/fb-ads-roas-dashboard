'use client';

import { useEffect, useMemo, useState } from 'react';
import { bangkokDay } from '@/lib/page-scheduler/schedule-time';
import type { PageTotal, SortKey } from '@/lib/page-scheduler/analytics-aggregate';
import AnalyticsPageTotals from './analytics-page-totals';
import AnalyticsTopPosts, { type TopPost } from './analytics-top-posts';
import type { TabProps } from './page-scheduler-hub';

const DAY_MS = 86_400_000;
const inputCls = 'border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white';

export default function AnalyticsTab({ role }: TabProps) {
  const [from, setFrom] = useState(() => bangkokDay(Date.now() - 30 * DAY_MS));
  const [to, setTo] = useState(() => bangkokDay(Date.now()));
  const [pageId, setPageId] = useState('');
  const [owner, setOwner] = useState('all');
  const [sort, setSort] = useState<SortKey>('engagement');
  const [posts, setPosts] = useState<TopPost[]>([]);
  const [totals, setTotals] = useState<PageTotal[]>([]);
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [pageOptions, setPageOptions] = useState<{ id: string; name: string }[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const showOwner = (role === 'admin' || role === 'leader') && Object.keys(owners).length > 1;

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ from, to, sort, owner });
    if (pageId) qs.set('page_id', pageId);
    fetch(`/api/page-scheduler/analytics?${qs}`)
      .then(async (res) => {
        const d = await res.json();
        if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
        if (cancelled) return;
        setPosts(d.posts ?? []);
        setTotals(d.totals ?? []);
        setOwners(d.owners ?? {});
        setTruncated(!!d.truncated);
        setError('');
        // Keep the Page dropdown stable once a Page is selected (totals shrink to that Page).
        if (!pageId) setPageOptions((d.totals as PageTotal[]).map((t) => ({ id: t.page_id, name: t.page_name || t.page_id })));
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load analytics'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [from, to, sort, owner, pageId]);

  const summary = useMemo(() => ({
    posts: totals.reduce((s, t) => s + t.posts, 0),
    engagement: totals.reduce((s, t) => s + t.engagement, 0),
  }), [totals]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-500 space-y-1 block">From
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={`${inputCls} block`} />
        </label>
        <label className="text-xs text-slate-500 space-y-1 block">To
          <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className={`${inputCls} block`} />
        </label>
        <label className="text-xs text-slate-500 space-y-1 block">Page
          <select value={pageId} onChange={(e) => setPageId(e.target.value)} className={`${inputCls} block`}>
            <option value="">All pages</option>
            {pageOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        {showOwner && (
          <label className="text-xs text-slate-500 space-y-1 block">Owner
            <select value={owner} onChange={(e) => { setOwner(e.target.value); setPageId(''); }} className={`${inputCls} block`}>
              <option value="all">All users</option>
              <option value="me">Me</option>
              {Object.entries(owners).map(([id, email]) => <option key={id} value={id}>{email}</option>)}
            </select>
          </label>
        )}
        <p className="text-xs text-slate-500 ml-auto">{summary.posts} posts · {summary.engagement.toLocaleString()} engagement (Bangkok days, by publish time)</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {truncated && <p className="text-xs text-amber-700">Very large range: only the newest 5,000 posts are included. Narrow the dates.</p>}
      {loading && posts.length === 0 ? <p className="text-sm text-slate-500">Loading…</p> : (
        <>
          <section className="space-y-2">
            <h3 className="font-semibold text-slate-900 text-sm">Per-Page totals</h3>
            {totals.length === 0 ? <p className="text-sm text-slate-500">No data.</p> : <AnalyticsPageTotals totals={totals} />}
          </section>
          <section className="space-y-2">
            <h3 className="font-semibold text-slate-900 text-sm">Top posts (max 200)</h3>
            <AnalyticsTopPosts posts={posts} sort={sort} onSort={setSort} showOwner={showOwner} />
          </section>
          <p className="text-xs text-slate-500">Counts refresh about every 6 hours for posts published in the last 14 days. Views/clicks need the read_insights permission.</p>
        </>
      )}
    </div>
  );
}
