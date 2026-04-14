# Phase 1: Types + Adjust Ad Set Aggregation

## Context Links
- [plan.md](plan.md)
- [lib/types.ts](../../lib/types.ts)
- [lib/adjust/csv-parser.ts](../../lib/adjust/csv-parser.ts)

## Overview
- **Priority:** P1 (blocker for all other phases)
- **Status:** Completed
- **Effort:** 1h
- Add `AdSetRow`, `MergedAdSet`, `AdjustAdSetRow` types; add `aggregateByAdSetId()` to csv-parser

## Key Insights
- Adjust CSV already contains `adgroup_id_network` and `adgroup_network` columns per row
- `RawAdjustRow` interface already declares these fields but they are unused
- Ad set IDs in FB are pure numeric strings (same validation as campaign IDs)
- Revenue per ad set row = `cohort_all_revenue` (same column, already parsed)

## Files to Modify
- `lib/types.ts` — add 3 new interfaces
- `lib/adjust/csv-parser.ts` — add `parseAdjustAdSetRows()` and `aggregateByAdSetId()`

## Implementation Steps

### Step 1: Add types to `lib/types.ts`

After the `AdjustRow` interface, add:

```typescript
/** Row from Adjust CSV aggregated by ad set (adgroup) */
export interface AdjustAdSetRow {
  adset_id: string;      // adgroup_id_network column
  adset_name: string;    // adgroup_network column
  campaign_id: string;   // campaign_id_network (parent)
  revenue: number;       // cohort_all_revenue
}

/** Live FB ad set data from Marketing API v21 */
export interface AdSetRow {
  adset_id: string;
  adset_name: string;
  campaign_id: string;
  account_id: string;
  currency: string;
  status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DELETED' | string;
  effective_status: string;
  daily_budget: number | null;
  lifetime_budget: number | null;
  budget_remaining: number | null;
  budget_type: 'daily' | 'lifetime' | 'unknown';
  spend: number;
  impressions: number;
  clicks: number;
  cpm: number;
  cpc: number;
}

/** FB ad set merged with Adjust revenue data */
export interface MergedAdSet extends AdSetRow {
  adjust_revenue: number | null;
  roas: number | null;
  has_adjust_data: boolean;
}
```

### Step 2: Add ad set aggregation to `lib/adjust/csv-parser.ts`

Add new export `parseAdjustAdSetRows()` that returns `AdjustAdSetRow[]` from same CSV:

```typescript
export function parseAdjustAdSetCsv(file: File, appFilter?: string): Promise<AdjustAdSetRow[]> {
  // Same Papa.parse pattern as parseAdjustCsv
  // Filter: channel === 'facebook', valid adgroup_id_network (numeric)
  // Map each row to { adset_id, adset_name, campaign_id, revenue }
}
```

Add `aggregateByAdSetId()`:

```typescript
export function aggregateByAdSetId(rows: AdjustAdSetRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.adset_id, (map.get(row.adset_id) ?? 0) + row.revenue);
  }
  return map;
}
```

**Important:** Reuse `isValidCampaignId()` for ad set ID validation (same format: numeric string). Rename it to `isValidFbId()` internally or just reuse as-is since it's a private function.

### Step 3: Add merge function to `lib/adjust/merge.ts`

Add `mergeAdSets()` function (mirrors `mergeCampaigns()`):

```typescript
export function mergeAdSets(
  fbAdSets: AdSetRow[],
  adjustMap: Map<string, number>,
  vndRate: number = 26000,
): MergedAdSet[] {
  return fbAdSets.map((adset) => {
    const rate = adset.currency === 'VND' ? vndRate : 1;
    const spendUsd = adset.spend / rate;
    const cpmUsd = adset.cpm / rate;
    const cpcUsd = adset.cpc / rate;
    const adjustRevenue = adjustMap.get(adset.adset_id) ?? null;
    return {
      ...adset,
      spend: spendUsd,
      cpm: cpmUsd,
      cpc: cpcUsd,
      adjust_revenue: adjustRevenue,
      roas: computeRoas(adjustRevenue, spendUsd),
      has_adjust_data: adjustRevenue !== null,
    };
  });
}
```

## Todo List
- [x] Add `AdjustAdSetRow`, `AdSetRow`, `MergedAdSet` to `lib/types.ts`
- [x] Add `parseAdjustAdSetCsv()` to `lib/adjust/csv-parser.ts`
- [x] Add `aggregateByAdSetId()` to `lib/adjust/csv-parser.ts`
- [x] Add `mergeAdSets()` to `lib/adjust/merge.ts`
- [x] Verify `npm run build` passes

## Success Criteria
- Types compile without errors
- `aggregateByAdSetId()` correctly sums revenue by adset_id
- `mergeAdSets()` produces correct ROAS with VND conversion
- Existing `parseAdjustCsv()` and `aggregateByCampaignId()` unchanged

## Risk
- **Ad set ID format:** FB ad set IDs are numeric like campaign IDs. If Adjust uses a different format, validation will reject them. Mitigation: check a sample CSV.
