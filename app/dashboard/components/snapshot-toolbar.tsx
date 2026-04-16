'use client';

import { useEffect, useRef, useState } from 'react';
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
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  /** Close dropdown when clicking outside */
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

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
              <span key={id} className="inline-flex items-center gap-1.5">
                {/* Chip */}
                <span className="inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                  <span className="text-amber-400 font-bold">#{idx + 1}</span>
                  {meta.name}
                  <span className="text-amber-500 text-[10px]">({formatDate(meta.created_at)})</span>
                  {/* Remove from comparison — inside chip */}
                  <button
                    onClick={() => onRemove(id)}
                    className="ml-1 w-5 h-5 flex items-center justify-center rounded-full bg-amber-200 hover:bg-slate-300 text-amber-700 hover:text-slate-800 transition-colors text-sm font-bold leading-none"
                    title="Remove from comparison"
                  >
                    ×
                  </button>
                </span>
                {/* Permanent delete — outside chip, visually separated */}
                <button
                  onClick={() => handleDelete(id)}
                  disabled={deleting === id}
                  className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-red-600 hover:border-red-300 hover:bg-red-50 transition-colors disabled:opacity-40 text-sm"
                  title="Delete snapshot permanently"
                >
                  {deleting === id ? '…' : '🗑'}
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Custom dropdown — shows available snapshots with inline delete button */}
      {availableSnapshots.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-400">{comparedIds.length > 0 ? '+' : 'Compare:'}</span>
          <div ref={dropdownRef} className="relative">
            <button
              onClick={() => setDropdownOpen((o) => !o)}
              className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 flex items-center gap-1.5 min-w-[160px] justify-between"
            >
              <span>Add snapshot…</span>
              <span className="text-slate-400 text-[10px]">{dropdownOpen ? '▲' : '▼'}</span>
            </button>

            {dropdownOpen && (
              <div className="absolute z-50 left-0 top-full mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                {availableSnapshots.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                  >
                    {/* Add to compare on name click */}
                    <button
                      onClick={() => { onAdd(s.id); setDropdownOpen(false); }}
                      className="flex-1 text-left text-xs text-slate-700 hover:text-indigo-600 transition-colors min-w-0"
                    >
                      <span className="font-medium truncate block">{s.name}</span>
                      <span className="text-slate-400 text-[10px]">{formatDate(s.created_at)}</span>
                    </button>
                    {/* Delete permanently */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                      disabled={deleting === s.id}
                      className="ml-3 w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-300 hover:bg-red-50 transition-colors disabled:opacity-40 text-sm"
                      title={`Delete "${s.name}" permanently`}
                    >
                      {deleting === s.id ? '…' : '🗑'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
