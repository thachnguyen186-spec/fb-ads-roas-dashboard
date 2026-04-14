# Phase 3: Collapsible Table UI

## Context Links
- [plan.md](plan.md)
- [phase-01](phase-01-types-and-adjust-adsets.md), [phase-02](phase-02-fb-adsets-api.md)
- [campaign-table.tsx](../../app/dashboard/components/campaign-table.tsx)
- [campaign-hub.tsx](../../app/dashboard/components/campaign-hub.tsx)

## Overview
- **Priority:** P1
- **Status:** Completed
- **Effort:** 2h
- Add expand/collapse toggle per campaign row; lazy-fetch ad sets; render sub-rows

## Key Insights
- Table currently renders flat `MergedCampaign[]` rows
- Ad set sub-rows share same column layout (name, status, spend, impr, clicks, CPM, CPC, revenue, ROAS)
- Lazy load: only fetch when user clicks expand; cache in parent state to avoid re-fetch
- Adjust ad set map must be built during initial CSV parse (same time as campaign map)
- Sub-rows visually indented with lighter background to distinguish from campaign rows

## Data Flow

```
campaign-hub.tsx
  ├── handleAnalyze() now also calls parseAdjustAdSetCsv() + aggregateByAdSetId()
  ├── stores adjustAdSetMap: Map<string, number> in state
  ├── passes adjustAdSetMap to CampaignTable
  └── passes vndRate to CampaignTable (for ad set merge)

campaign-table.tsx
  ├── New state: expandedCampaigns: Set<string>
  ├── New state: adSetCache: Map<string, MergedAdSet[]>
  ├── New state: loadingAdSets: Set<string>
  ├── On toggle expand:
  │     if cached → just toggle visibility
  │     else → fetch GET /api/campaigns/{id}/adsets?accountId=X&currency=Y
  │           → mergeAdSets(response.adsets, adjustAdSetMap, vndRate)
  │           → store in adSetCache
  └── Render sub-rows beneath expanded campaign row
```

## Files to Modify
- `app/dashboard/components/campaign-hub.tsx` — add adjustAdSetMap state, pass to table
- `app/dashboard/components/campaign-table.tsx` — expand toggle, sub-row rendering, fetch logic

## Implementation Steps

### Step 1: Update `campaign-hub.tsx`

Add alongside existing `adjustMapState`:

```typescript
import { parseAdjustAdSetCsv, aggregateByAdSetId } from '@/lib/adjust/csv-parser';

const [adjustAdSetMap, setAdjustAdSetMap] = useState<Map<string, number>>(new Map());
```

In `handleAnalyze()`, parallel-parse both campaign and ad set data:

```typescript
const [fbRes, adjustRows, adjustAdSetRows] = await Promise.all([
  fetch(url.toString()).then((r) => r.json()),
  parseAdjustCsv(csvFile, appFilter),
  parseAdjustAdSetCsv(csvFile, appFilter),  // NEW
]);
const adjustAdSetMap = aggregateByAdSetId(adjustAdSetRows);
setAdjustAdSetMap(adjustAdSetMap);
```

Pass to CampaignTable:

```tsx
<CampaignTable
  campaigns={displayedCampaigns}
  adjustAdSetMap={adjustAdSetMap}   // NEW
  vndRate={vndRate}                  // NEW
  // ...existing props
/>
```

Also reset `adjustAdSetMap` in `handleStartOver()`.

### Step 2: Update `campaign-table.tsx` — Props + State

Add new props:

```typescript
interface Props {
  // ...existing
  adjustAdSetMap: Map<string, number>;
  vndRate: number;
}
```

Add state inside component:

```typescript
const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
const [adSetCache, setAdSetCache] = useState<Map<string, MergedAdSet[]>>(new Map());
const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
```

### Step 3: Toggle + Fetch Logic

```typescript
async function toggleExpand(campaign: MergedCampaign) {
  const id = campaign.campaign_id;

  // Already expanded → collapse
  if (expandedIds.has(id)) {
    setExpandedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    return;
  }

  // Expand
  setExpandedIds((prev) => new Set(prev).add(id));

  // Already cached → done
  if (adSetCache.has(id)) return;

  // Fetch
  setLoadingIds((prev) => new Set(prev).add(id));
  try {
    const url = new URL(`/api/campaigns/${id}/adsets`, window.location.origin);
    url.searchParams.set('accountId', campaign.account_id);
    url.searchParams.set('currency', campaign.currency);
    const res = await fetch(url.toString());
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Failed to load ad sets');

    const merged = mergeAdSets(data.adsets, adjustAdSetMap, vndRate);
    setAdSetCache((prev) => new Map(prev).set(id, merged));
  } catch (err) {
    console.error('Ad set fetch error:', err);
    setAdSetCache((prev) => new Map(prev).set(id, [])); // empty = failed
  } finally {
    setLoadingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }
}
```

### Step 4: Render Expand Toggle + Sub-rows

In the campaign row's first `<td>` (checkbox cell), add expand button before checkbox:

```tsx
<td className="px-4 py-2.5 flex items-center gap-1">
  <button
    onClick={() => toggleExpand(c)}
    className="text-gray-400 hover:text-gray-700 text-xs w-4"
  >
    {expandedIds.has(c.campaign_id) ? '▼' : '▶'}
  </button>
  <input type="checkbox" ... />
</td>
```

After each campaign `<tr>`, conditionally render ad set sub-rows:

```tsx
{expandedIds.has(c.campaign_id) && (
  <>
    {loadingIds.has(c.campaign_id) && (
      <tr><td colSpan={totalCols} className="px-8 py-2 text-xs text-gray-400">
        Loading ad sets...
      </td></tr>
    )}
    {adSetCache.get(c.campaign_id)?.map((adset) => (
      <tr key={adset.adset_id} className="bg-gray-50/60">
        <td className="px-4 py-2" /> {/* empty checkbox col — or add selection later */}
        <td className="px-3 py-2 pl-8 border-r border-gray-100">
          <div className="text-gray-700 text-xs truncate">{adset.adset_name}</div>
          <div className="text-[10px] text-gray-400 font-mono">{adset.adset_id}</div>
        </td>
        {/* Same columns: status, spend, impr, clicks, CPM, CPC, revenue, match, ROAS */}
        {/* Use same fmtUsd/fmtNum/roasColorClass helpers */}
      </tr>
    ))}
    {adSetCache.has(c.campaign_id) && adSetCache.get(c.campaign_id)!.length === 0 && (
      <tr><td colSpan={totalCols} className="px-8 py-2 text-xs text-gray-400">
        No active ad sets
      </td></tr>
    )}
  </>
)}
```

### Step 5: Visual Design for Sub-rows

- Indent ad set name cell with `pl-8`
- Lighter background: `bg-gray-50/60`
- Smaller text: `text-xs` for name, `text-[10px]` for ID
- No checkbox for ad sets in this phase (selection is campaign-level only for now)
- Keep same column alignment as campaign rows

## Todo List
- [x] Add `adjustAdSetMap` state + parsing to `campaign-hub.tsx`
- [x] Pass `adjustAdSetMap` and `vndRate` as props to `CampaignTable`
- [x] Add expand/collapse state + fetch logic to `campaign-table.tsx`
- [x] Render expand toggle button in campaign rows
- [x] Render ad set sub-rows with loading/empty states
- [x] Reset expand state on `handleStartOver()`
- [x] Verify `npm run build` passes
- [x] Manual test: expand 2-3 campaigns, verify sub-rows render

## Success Criteria
- Clicking expand on a campaign row fetches and displays ad set sub-rows
- Sub-rows show: name, status, spend, impressions, clicks, CPM, CPC, revenue, ROAS
- Collapsing hides sub-rows; re-expanding uses cache (no re-fetch)
- Loading spinner shown during fetch
- Empty state shown for campaigns with no active ad sets

## Risk
- **Table column alignment:** Sub-rows must align with campaign columns. If `showAccountColumn` changes col count, sub-row `colSpan` must adapt. Mitigation: compute `totalCols` dynamically.
- **Stale cache:** If user edits budget then re-expands, cache is stale. Mitigation: Phase 4 will invalidate cache entry after budget update.
