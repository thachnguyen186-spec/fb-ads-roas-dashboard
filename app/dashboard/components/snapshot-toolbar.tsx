'use client';

import { useState } from 'react';
import type { SnapshotMeta } from '@/lib/types';

interface Props {
  snapshots: SnapshotMeta[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSave: (name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  saving: boolean;
}

export default function SnapshotToolbar({ snapshots, selectedId, onSelect, onSave, onDelete, saving }: Props) {
  const [showInput, setShowInput] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function handleSave() {
    const name = nameInput.trim();
    if (!name) return;
    await onSave(name);
    setNameInput('');
    setShowInput(false);
  }

  async function handleDelete() {
    if (!selectedId) return;
    setDeleting(true);
    await onDelete(selectedId);
    setDeleting(false);
  }

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
          <button
            onClick={() => setShowInput(false)}
            className="px-2 py-1 text-xs text-slate-500 hover:text-slate-800"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowInput(true)}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 transition-colors flex items-center gap-1.5"
        >
          <span>💾</span> Save Snapshot
        </button>
      )}

      {/* Snapshot selector + delete */}
      {snapshots.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-400">Compare:</span>
          <select
            value={selectedId ?? ''}
            onChange={(e) => onSelect(e.target.value || null)}
            className="text-xs border border-slate-300 rounded-lg px-2 py-1 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 max-w-[200px]"
          >
            <option value="">— none —</option>
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({new Date(s.created_at).toLocaleDateString()})
              </option>
            ))}
          </select>
          {selectedId && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              title="Delete this snapshot"
              className="text-slate-400 hover:text-red-600 transition-colors text-sm disabled:opacity-50"
            >
              🗑
            </button>
          )}
        </div>
      )}
    </div>
  );
}
