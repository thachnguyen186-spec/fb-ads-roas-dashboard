'use client';

import { useMemo, useState } from 'react';
import { buildSnapshotComparisons, toSnapshotData } from '@/lib/tiktok/snapshot-helpers';
import type { MergedTiktokCampaign, SnapshotData, SnapshotMeta } from '@/lib/types';

const API = '/api/snapshots';

/** Save/list/compare/delete of TikTok campaign snapshots (platform='tiktok'). Mirrors the FB hub's handlers. */
export function useTiktokSnapshots(campaigns: MergedTiktokCampaign[]) {
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [comparedIds, setComparedIds] = useState<string[]>([]);
  const [cache, setCache] = useState<Map<string, SnapshotData>>(new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const res = await fetch(`${API}?platform=tiktok`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `Failed to load snapshots (${res.status})`);
      setSnapshots((data as { snapshots?: SnapshotMeta[] }).snapshots ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load snapshots');
    }
  }

  async function add(id: string) {
    if (!cache.has(id)) {
      try {
        const res = await fetch(`${API}/${id}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string }).error ?? `Failed to load snapshot (${res.status})`);
        setCache((prev) => new Map([...prev, [id, (data as { snapshot_data: SnapshotData }).snapshot_data]]));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load snapshot');
        return;
      }
    }
    // New additions go leftmost (older ones pushed toward Current), same as FB.
    setComparedIds((prev) => (prev.includes(id) ? prev : [id, ...prev]));
  }

  function remove(id: string) {
    setComparedIds((prev) => prev.filter((s) => s !== id));
  }

  async function save(name: string) {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, platform: 'tiktok', snapshot_data: toSnapshotData(campaigns) }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData as { error?: string }).error ?? `Save failed (${res.status})`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save snapshot');
    } finally {
      setSaving(false);
    }
  }

  async function del(id: string) {
    try {
      const res = await fetch(`${API}/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData as { error?: string }).error ?? `Delete failed (${res.status})`);
      }
      remove(id);
      setCache((prev) => { const m = new Map(prev); m.delete(id); return m; });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete snapshot');
    }
  }

  function reset() {
    setSnapshots([]); setComparedIds([]); setCache(new Map()); setError('');
  }

  const comparisons = useMemo(
    () => buildSnapshotComparisons(comparedIds, cache, snapshots),
    [comparedIds, cache, snapshots],
  );

  return { snapshots, comparedIds, comparisons, saving, error, clearError: () => setError(''), load, add, remove, save, del, reset };
}
