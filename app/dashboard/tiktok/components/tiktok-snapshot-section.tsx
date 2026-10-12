'use client';

import SnapshotToolbar from '@/app/dashboard/components/snapshot-toolbar';
import type { useTiktokSnapshots } from './use-tiktok-snapshots';

/** Same SnapshotToolbar as the FB dashboard plus an error strip. Saving is blocked while Adjust
 * revenue is missing — such a snapshot would hold spend only and every later delta would be "—". */
export default function TiktokSnapshotSection({ snap, revenueMissing }: { snap: ReturnType<typeof useTiktokSnapshots>; revenueMissing: boolean }) {
  return (
    <>
      <SnapshotToolbar
        snapshots={snap.snapshots}
        comparedIds={snap.comparedIds}
        onAdd={snap.add}
        onRemove={snap.remove}
        onSave={revenueMissing ? async () => {} : snap.save}
        onDelete={snap.del}
        saving={snap.saving}
      />
      {revenueMissing && (
        <p className="text-xs text-amber-700">Saving snapshots is disabled until Adjust revenue loads.</p>
      )}
      {snap.error && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          <span>Snapshot error: {snap.error}</span>
          <button onClick={snap.clearError} className="text-red-400 hover:text-red-700 ml-auto">✕</button>
        </div>
      )}
    </>
  );
}
