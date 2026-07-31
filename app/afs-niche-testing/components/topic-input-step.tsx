'use client';

import { useEffect, useState } from 'react';

export interface TopicRow {
  id: string;
  description: string;
  target_url: string;
}

interface Props {
  rows: TopicRow[];
  onRowsChange: (rows: TopicRow[]) => void;
  onValidityChange: (valid: boolean) => void;
}

const MAX_TOPICS = 20;

/** Splits pasted text into rows, one per line, on the FIRST tab or comma only (URLs may contain commas). */
function parseTopics(text: string): TopicRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.search(/[\t,]/);
      const description = idx === -1 ? line : line.slice(0, idx).trim();
      const target_url = idx === -1 ? '' : line.slice(idx + 1).trim();
      return { id: crypto.randomUUID(), description, target_url };
    });
}

function rowError(row: TopicRow): string | null {
  if (!row.description.trim()) return 'Description is required';
  if (!row.target_url.trim()) return 'Target URL is required';
  if (!row.target_url.trim().startsWith('https://')) return 'URL must start with https://';
  return null;
}

export default function TopicInputStep({ rows, onRowsChange, onValidityChange }: Props) {
  const [pasteText, setPasteText] = useState('');

  const errors = rows.map(rowError);
  const overLimit = rows.length > MAX_TOPICS;
  const hasErrors = errors.some(Boolean);
  const urlCounts = new Map<string, number>();
  rows.forEach((r) => {
    const key = r.target_url.trim().toLowerCase();
    if (key) urlCounts.set(key, (urlCounts.get(key) ?? 0) + 1);
  });

  const isValid = !overLimit && !hasErrors && rows.length > 0;
  useEffect(() => {
    onValidityChange(isValid);
  }, [isValid, onValidityChange]);

  function handleAddFromPaste() {
    const parsed = parseTopics(pasteText);
    if (parsed.length === 0) return;
    onRowsChange([...rows, ...parsed]);
    setPasteText('');
  }

  function updateRow(id: string, field: 'description' | 'target_url', value: string) {
    onRowsChange(rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function removeRow(id: string) {
    onRowsChange(rows.filter((r) => r.id !== id));
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
      <h2 className="font-semibold text-slate-900">Topics</h2>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Paste topics — one per line:{' '}
          <code className="bg-slate-100 px-1 rounded">description [Tab or comma] https://target-url</code>
        </label>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={5}
          placeholder={'Solar panel installers, https://example.com/solar\nHome security systems, https://example.com/security'}
          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="button"
          onClick={handleAddFromPaste}
          disabled={!pasteText.trim()}
          className="mt-2 px-4 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-200 disabled:opacity-50"
        >
          Add to list
        </button>
      </div>

      <div className="flex items-center justify-between">
        <p className={`text-xs ${overLimit ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
          {rows.length} / {MAX_TOPICS} topics
        </p>
        {overLimit && <p className="text-xs text-red-600">Remove {rows.length - MAX_TOPICS} row(s) to continue.</p>}
      </div>

      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((row, i) => {
            const err = errors[i];
            const dupKey = row.target_url.trim().toLowerCase();
            const isDup = dupKey.length > 0 && (urlCounts.get(dupKey) ?? 0) > 1;
            return (
              <div key={row.id} className="flex items-start gap-2">
                <div className="flex-1 space-y-1">
                  <input
                    value={row.description}
                    onChange={(e) => updateRow(row.id, 'description', e.target.value)}
                    placeholder="Topic description"
                    className={`w-full px-2 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${err ? 'border-red-300' : 'border-slate-300'}`}
                  />
                  <input
                    value={row.target_url}
                    onChange={(e) => updateRow(row.id, 'target_url', e.target.value)}
                    placeholder="https://…"
                    className={`w-full px-2 py-1.5 border rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 ${err ? 'border-red-300' : 'border-slate-300'}`}
                  />
                  {err && <p className="text-xs text-red-600">{err}</p>}
                  {!err && isDup && <p className="text-xs text-amber-600">Duplicate URL — allowed, but double-check.</p>}
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  className="text-slate-300 hover:text-red-500 text-sm mt-1.5"
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
