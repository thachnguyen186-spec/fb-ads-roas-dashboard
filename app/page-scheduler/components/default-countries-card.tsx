'use client';

import { useEffect, useState } from 'react';

const TIER1 = ['US', 'GB', 'CA', 'AU', 'NZ', 'IE', 'DE', 'FR', 'NL', 'SE', 'NO', 'DK', 'FI'];

function parse(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean))];
}

export default function DefaultCountriesCard() {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/page-scheduler/settings')
      .then((r) => r.json())
      .then((d) => setText((d.default_countries ?? TIER1).join(', ')))
      .catch(() => setText(TIER1.join(', ')))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/page-scheduler/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_countries: parse(text) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to save');
      setText((data.default_countries as string[]).join(', '));
      setMsg({ kind: 'ok', text: 'Saved' });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
      <div>
        <h2 className="font-semibold text-slate-900">Default target countries</h2>
        <p className="text-xs text-slate-500 mt-1">
          Used for posts whose upload row has no countries. ISO-2 codes, 1-25, separated by commas or spaces. Personal to you.
        </p>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => setText(TIER1.join(', '))} className="text-sm text-slate-500 hover:text-slate-700">
          Reset to tier-1 preset
        </button>
        {msg && <span className={`text-sm ${msg.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
