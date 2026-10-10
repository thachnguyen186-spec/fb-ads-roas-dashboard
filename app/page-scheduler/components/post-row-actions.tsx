'use client';

import { useState } from 'react';
import { formatBangkok } from '@/lib/page-scheduler/schedule-time';

export interface QueuePost {
  id: string;
  status: string;
  message: string;
  scheduled_at: string;
  countries: string[];
  fb_post_id: string | null;
  error: string | null;
}

interface Props {
  post: QueuePost;
  onChanged: () => void;
  onNotice: (msg: string, link?: string) => void;
}

async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; error?: string; link?: string }> {
  try {
    const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const d = (await r.json().catch(() => ({}))) as { error?: string; link?: string };
    return r.ok ? { ok: true } : { ok: false, error: d.error ?? `HTTP ${r.status}`, link: d.link };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Request failed' };
  }
}

const btn = 'text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50';

export default function PostRowActions({ post, onChanged, onNotice }: Props) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState(post.message);
  const [time, setTime] = useState(formatBangkok(post.scheduled_at));
  const [countries, setCountries] = useState(post.countries.length ? post.countries.join(', ') : 'ALL');
  const [formError, setFormError] = useState('');

  const canEdit = ['queued', 'waiting', 'failed'].includes(post.status);
  const canRetry = post.status === 'failed' && !post.fb_post_id;
  const canCancel = ['draft', 'queued', 'waiting', 'failed'].includes(post.status) || (post.status === 'scheduled' && !!post.fb_post_id);

  async function run(fn: () => Promise<{ ok: boolean; error?: string; link?: string }>) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.ok) onNotice(r.error ?? 'Action failed', r.link);
    onChanged();
    return r.ok;
  }

  async function retry() {
    let confirm = false;
    if (/uncertain/i.test(post.error ?? '')) {
      if (!window.confirm('This post may already exist on Facebook. Did you check Meta Business Suite? Retry anyway?')) return;
      confirm = true;
    }
    await run(() => call(`/api/page-scheduler/posts/${post.id}/retry`, 'POST', { confirm_uncertain: confirm }));
  }

  async function cancel() {
    const warn = post.status === 'scheduled' ? 'Cancel this scheduled post on Facebook?' : 'Cancel this post?';
    if (window.confirm(warn)) await run(() => call(`/api/page-scheduler/posts/${post.id}`, 'DELETE'));
  }

  async function save() {
    setFormError('');
    const body: Record<string, unknown> = {};
    if (message !== post.message) body.message = message;
    if (time !== formatBangkok(post.scheduled_at)) body.scheduled_at = time;
    const list = countries.trim().toUpperCase() === 'ALL' ? [] : countries.split(/[|,;\s]+/).filter(Boolean);
    if (list.join(',') !== post.countries.join(',')) body.countries = list;
    if (Object.keys(body).length === 0) { setEditing(false); return; }
    setBusy(true);
    const r = await call(`/api/page-scheduler/posts/${post.id}`, 'PATCH', body);
    setBusy(false);
    if (!r.ok) { setFormError(r.error ?? 'Update failed'); return; }
    setEditing(false);
    onChanged();
  }

  return (
    <>
      <div className="flex gap-1 justify-end">
        {canEdit && <button className={btn} disabled={busy} onClick={() => setEditing(true)}>Edit</button>}
        {canRetry && <button className={btn} disabled={busy} onClick={retry}>Retry</button>}
        {canCancel && <button className={`${btn} text-red-600`} disabled={busy} onClick={cancel}>Cancel</button>}
      </div>
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setEditing(false)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-lg space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-900">Edit post</h3>
            <label className="block text-sm text-slate-700">Message
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} className="mt-1 w-full border border-slate-300 rounded-lg p-2 text-sm" />
            </label>
            <label className="block text-sm text-slate-700">Time (Bangkok, YYYY-MM-DD HH:mm)
              <input value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg p-2 text-sm" />
            </label>
            <label className="block text-sm text-slate-700">Countries (ISO codes, or ALL for no targeting)
              <input value={countries} onChange={(e) => setCountries(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg p-2 text-sm" />
            </label>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <div className="flex justify-end gap-2">
              <button className={btn} disabled={busy} onClick={() => setEditing(false)}>Close</button>
              <button className="text-sm px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-50" disabled={busy} onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
