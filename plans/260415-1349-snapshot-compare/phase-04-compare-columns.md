# Phase 4 — Compare Columns

## Files to modify
- `app/dashboard/components/campaign-table.tsx`
- `app/dashboard/components/adset-rows.tsx`
- `app/dashboard/components/adset-flat-view.tsx`

## New prop on each component
```typescript
snapshotCampaignMap: Map<string, SnapshotRow> | null   // campaign-table
snapshotAdSetMap: Map<string, SnapshotAdSetRow> | null  // adset-rows, adset-flat-view
```

## Extra columns (when snapshot active)
Appended after %Profit in the "Result" group:

| Column | Value | Color |
|--------|-------|-------|
| Old ROAS | snapshot roas | same roasColorClass |
| Old %Profit | snapshot profit_pct | green/red |
| Δ ROAS | current - old | green if +, red if - |
| Δ %Profit | current - old | green if +, red if - |

- Show `—` when campaign/adset not found in snapshot
- `colCount` increases by 4 when snapshot active (passed to AdSetRows for colspan)
- Result group `colSpan` increases by 4

## campaign-hub.tsx — derive maps for passing down
```typescript
const snapshotCampaignMap = useMemo(() => {
  if (!activeSnapshot) return null;
  return new Map(activeSnapshot.campaigns.map((r) => [r.campaign_id, r]));
}, [activeSnapshot]);

const snapshotAdSetMap = useMemo(() => {
  if (!activeSnapshot) return null;
  return new Map(activeSnapshot.adsets.map((r) => [r.adset_id, r]));
}, [activeSnapshot]);
```
Pass both maps to CampaignTable and snapshotAdSetMap to AdsetFlatView.
CampaignTable passes snapshotAdSetMap down to AdSetRows.
