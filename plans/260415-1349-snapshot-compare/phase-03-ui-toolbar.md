# Phase 3 — Snapshot Toolbar Component

## Files to create
- `app/dashboard/components/snapshot-toolbar.tsx` — save + selector UI

## Files to modify
- `app/dashboard/components/campaign-hub.tsx` — integrate toolbar, manage snapshot state

## snapshot-toolbar.tsx Props
```typescript
interface Props {
  onSave: (name: string) => Promise<void>;
  snapshots: SnapshotMeta[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => Promise<void>;
  saving: boolean;
}
```

## UI Layout
```
[ 💾 Save Snapshot ] [input: name...] | Compare: [dropdown ▼] [🗑]
```
- Save button → shows inline name input → confirm saves → reloads list
- Dropdown lists all saved snapshots by name (newest first)
- Trash icon (🗑) appears when a snapshot is selected → deletes + clears selection
- Shown only in results phase, above filter bar

## campaign-hub.tsx additions
New state:
```typescript
const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
const [activeSnapshot, setActiveSnapshot] = useState<SnapshotData | null>(null);
const [savingSnapshot, setSavingSnapshot] = useState(false);
```

On results load: `fetchSnapshots()` → GET /api/snapshots
On snapshot select: `loadSnapshot(id)` → GET /api/snapshots/[id] (full data)
On save: collect campaigns + fetch all adsets → POST /api/snapshots
On delete: DELETE /api/snapshots/[id] → clear selection if matches

## GET /api/snapshots/[id] (full data route — add to phase 2)
Returns `{ id, name, created_at, snapshot_data: SnapshotData }` for loading compare.
