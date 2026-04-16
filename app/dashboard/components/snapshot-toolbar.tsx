'use client';

import { useState } from 'react';
import type { SnapshotMeta } from '@/lib/types';

interface Props {
  snapshots: SnapshotMeta[];
  /** Ordered list of snapshot IDs currently being compared */
  comparedIds: string[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onSave: (name: string) => Promise<void>;
  /** Permanently deletes a snapshot (also removes it from comparison) */
  onDelete: (id: string) => Promise<void>;
  saving: boolean;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')} (${d.getDate()}/${d.getMonth() + 1})`;
}

export default function SnapshotToolbar({ snapshots, comparedIds, onAdd, onRemove, onSave, onDelete, saving }: Props) {
  const [showInput, setShowInput] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleSave() {
    const name = nameInput.trim();
    if (!name) return;
    await onSave(name);
    setNameInput('');
    setShowInput(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this snapshot permanently?')) return;
    setDeleting(id);
    await onDelete(id);
    setDeleting(null);
  }

  /** Snapshots not yet added to the comparison list */
  const availableSnapshots = snapshots.filter((s) => !comparedIds.includes(s.id));

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Save snapshot */}
      {showInput ? (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setShowInput(false); }}
            placeholder="Snapshot name…"
            className="px-2 py-1 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 w-44 text-slate-900"
          />
          <button
            onClick={handleSave}
            disabled={saving || !nameInput.trim()}
            className="px-2.5 py-1 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => setShowInput(false)} className="px-2 py-1 text-xs text-slate-500 hover:text-slate-800">✕</button>
        </div>
      ) : (
        <button
          onClick={() => setShowInput(true)}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 transition-colors flex items-center gap-1.5"
        >
          <span>💾</span> Save Snapshot
        </button>
      )}

      {/* Currently compared snapshots — chips with remove-from-compare (×) and permanent-delete (🗑) */}
      {comparedIds.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-slate-400">Compare:</span>
          {comparedIds.map((id, idx) => {
            const meta = snapshots.find((s) => s.id === id);
            if (!meta) return null;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200"
              >
                <span className="text-amber-400 font-bold mr-0.5">#{idx + 1}</span>
                {meta.name}
                <span className="text-amber-500 text-[10px] ml-0.5">({formatDate(meta.created_at)})</span>
                {/* Remove from comparison */}
                <button
                  onClick={() => onRemove(id)}
                  className="ml-0.5 text-amber-500 hover:text-slate-700 transition-colors leading-none px-0.5 rounded"
                  title="Remove from comparison"
                >
                  ×
                </button>
                {/* Permanent delete */}
                <button
                  onClick={() => handleDelete(id)}
                  disabled={deleting === id}
                  className="text-amber-400 hover:text-red-600 transition-colors leading-none px-0.5 rounded disabled:opacity-40"
                  title="Delete snapshot permanently"
                >
                  {deleting === id ? '…' : '🗑'}
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Add snapshot selector — only shows snapshots not yet in comparison */}
      {availableSnapshots.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-400">{comparedIds.length > 0 ? '+' : 'Compare:'}</span>
          <select
            value=""
            onChange={(e) => { if (e.target.value) onAdd(e.target.value); }}
            className="text-xs border border-slate-300 rounded-lg px-2 py-1 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 max-w-[220px]"
          >
            <option value="">Add snapshot…</option>
            {availableSnapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({formatDate(s.created_at)})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Allow deleting snapshots that are NOT in comparison (visible in available list) */}
      {snapshots.filter((s) => !comparedIds.includes(s.id)).map((s) => (
        <button
          key={s.id}
          onClick={() => handleDelete(s.id)}
          disabled={deleting === s.id}
          title={`Delete "${s.name}" permanently`}
          className="text-slate-300 hover:text-red-500 transition-colors text-xs disabled:opacity-40"
        >
          {deleting === s.id ? '…' : ''}
        </button>
      ))}
    </div>
  );
}
