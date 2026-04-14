# Phase 03 — Adjust CSV Upload + ROAS Merge

## Context Links
- Parent plan: [plan.md](./plan.md)
- CSV/ROAS research: [researcher-csv-roas-report.md](./research/researcher-csv-roas-report.md)
- Phase 04 UI (consumes merge output): [phase-04-campaign-dashboard-ui.md](./phase-04-campaign-dashboard-ui.md)

## Overview
- **Date:** 2026-04-14
- **Priority:** P1
- **Status:** pending (requires Phase 02 for `CampaignRow` type)
- **Description:** Client-side Adjust CSV parsing with column mapping UI, ROAS computation, and left-join merge with FB campaign data. Entirely browser-side — no file upload to server.

## Key Insights
- **Adjust CSV format is now known** — no flexible column mapping needed, use fixed field names
- **Actual columns:** `app, channel, campaign_network, campaign_id_network, adgroup_network, adgroup_id_network, cost, all_revenue, cohort_all_revenue`
- **Join key:** `campaign_id_network` = FB campaign ID (numeric string)
- **Revenue field:** `cohort_all_revenue` (period-specific) — NOT `all_revenue` (lifetime cumulative)
- **Rows are ad-set level** — multiple rows share same `campaign_id_network` → must SUM `cohort_all_revenue` per campaign
- **Pre-filter:** keep only rows where `channel === 'Facebook'` (excludes Organic, unknown)
- **Skip invalid IDs:** `campaign_id_network` values of `'unknown'` or `'Expired Attributions'` must be excluded
- **Multi-app CSV:** file may contain multiple apps — add optional `app` filter dropdown in UI
- `cost` column is always 0.0 (FB doesn't push cost to Adjust) → use FB API spend for ROAS denominator
- ROAS = `cohort_all_revenue / fb_spend` — display as `2.45x`, color-coded
- Zero FB spend edge case: show `—` instead of `∞`
- **No column mapper needed** — fixed schema eliminates mapping UI complexity

## Requirements
- Client-side CSV parser using PapaParse with fixed known schema
- Pre-parse filter: `channel === 'Facebook'` + valid numeric `campaign_id_network`
- Optional `app` filter dropdown (for multi-app CSV files)
- Pre-merge aggregation: SUM `cohort_all_revenue` per `campaign_id_network`
- Merge function: `mergeCampaigns(fbRows, adjustMap)` → `MergedCampaign[]`
- ROAS computation with zero-spend edge case handling
- All logic in `lib/adjust/` — no server route needed
- **No column mapper component** — schema is fixed

## Adjust CSV Schema (confirmed from real export)

```
Columns: app, channel, campaign_network, campaign_id_network,
         adgroup_network, adgroup_id_network, cost, all_revenue, cohort_all_revenue

Join key:    campaign_id_network  → matches FB campaign_id
Revenue:     cohort_all_revenue   → period revenue (NOT all_revenue which is lifetime)
Filter rows: channel === 'Facebook'
             campaign_id_network is numeric (skip 'unknown', 'Expired Attributions')
Aggregate:   SUM cohort_all_revenue grouped by campaign_id_network
             (rows are ad-set level within campaigns)
```

## Architecture

```
AdjustCsvUpload component (client)
  ↓ FileReader → PapaParse (header: true, dynamicTyping: true)
  ↓
  Optional: AppFilter dropdown (unique values of `app` column)
  ↓
lib/adjust/csv-parser.ts
  - parseAdjustCsv(file, appFilter?) → AdjustRow[]
    1. Parse with PapaParse
    2. Filter: channel === 'Facebook'
    3. Filter: campaign_id_network is numeric string (not 'unknown'/'Expired Attributions')
    4. Optional: filter by appFilter
  - aggregateByCampaignId(rows) → Map<string, number>
    → SUM cohort_all_revenue per campaign_id_network

lib/adjust/merge.ts
  - mergeCampaigns(fb: CampaignRow[], adjustMap: Map<string, number>) → MergedCampaign[]
  - computeRoas(cohortRevenue, fbSpend) → number | null  (null if spend === 0)

MergedCampaign {
  ...CampaignRow           // all FB fields (id, name, status, spend, budget, impressions, cpm, cpc)
  adjust_revenue: number | null   // from cohort_all_revenue SUM
  roas: number | null             // null if no Adjust match or spend === 0
  has_adjust_data: boolean
}
```

## ROAS Color Thresholds
| ROAS | Color |
|------|-------|
| ≥ 2.0 | Green (`text-green-600`) |
| 1.0–1.99 | Yellow (`text-yellow-600`) |
| < 1.0 | Red (`text-red-600`) |
| null / N/A | Gray (`text-gray-400`) |

## Related Code Files

**Create:**
- `C:\Work\Tools\fb-ads-tool\lib\adjust\csv-parser.ts` — PapaParse wrapper + filter + aggregation
- `C:\Work\Tools\fb-ads-tool\lib\adjust\merge.ts` — merge + ROAS compute
- `C:\Work\Tools\fb-ads-tool\app\workspaces\[id]\campaigns\components\adjust-csv-upload.tsx` — file input + app filter

**No longer needed:**
- `column-mapper.tsx` — eliminated (fixed known schema)

**Modify:**
- `C:\Work\Tools\fb-ads-tool\lib\types.ts` — add `MergedCampaign`, `AdjustRow` types
- `C:\Work\Tools\fb-ads-tool\package.json` — add `papaparse` + `@types/papaparse`

## Implementation Steps
1. Install PapaParse: `npm install papaparse @types/papaparse`

2. Create `lib/adjust/csv-parser.ts`:
   ```typescript
   // Fixed schema — columns known from real Adjust export
   // app, channel, campaign_network, campaign_id_network,
   // adgroup_network, adgroup_id_network, cost, all_revenue, cohort_all_revenue

   parseAdjustCsv(file: File, appFilter?: string): Promise<AdjustRow[]>
   // 1. Papa.parse(file, { header: true, dynamicTyping: true, skipEmptyLines: true })
   // 2. filter: row.channel === 'Facebook'
   // 3. filter: isValidCampaignId(row.campaign_id_network)
   //    → isValidCampaignId = numeric string, not 'unknown'/'Expired Attributions'
   // 4. optional: filter by appFilter if provided
   // 5. return AdjustRow[]

   aggregateByCampaignId(rows: AdjustRow[]): Map<string, number>
   // SUM cohort_all_revenue grouped by campaign_id_network
   ```

3. Create `lib/adjust/merge.ts`:
   - `mergeCampaigns(fb: CampaignRow[], adjustMap: Map<string, number>): MergedCampaign[]`
   - Left join: iterate FB rows, lookup `campaign.id` in `adjustMap`
   - `computeRoas(revenue: number, spend: number): number | null` — null if spend === 0

4. Create `adjust-csv-upload.tsx` client component:
   - File input (drag-and-drop or click) — `.csv` only
   - On parse: extract unique `app` values → show optional app filter `<select>`
   - Show summary: "X Facebook campaigns found, Y apps detected"
   - Emit `onParsed(file: File, appFilter?: string)` — hub calls parse on Analyze click

5. Add types to `lib/types.ts`:
   ```typescript
   interface AdjustRow { campaign_id: string; campaign_name: string; revenue: number; app: string }
   interface MergedCampaign extends CampaignRow {
     adjust_revenue: number | null
     roas: number | null
     has_adjust_data: boolean
   }
   ```

## Todo List
- [ ] Install `papaparse @types/papaparse`
- [ ] Create `lib/adjust/csv-parser.ts` (fixed schema, filter, aggregate)
- [ ] Create `lib/adjust/merge.ts` (left join + ROAS compute)
- [ ] Create `adjust-csv-upload.tsx` (file input + optional app filter)
- [ ] Add `AdjustRow`, `MergedCampaign` types to `lib/types.ts`
- [ ] Test: upload the real Adjust CSV, verify campaigns aggregate correctly by campaign_id_network

## Success Criteria
- CSV file upload parses headers and shows column mapping dropdowns
- After mapping, merged data shows ROAS = Adjust Revenue / FB Spend
- FB campaigns with no Adjust match show `has_adjust_data: false`, ROAS displays `—`
- Zero-spend campaigns show `—` (not `∞` or error)

## Risk Assessment
- **Campaign ID format mismatch:** FB uses numeric string IDs; Adjust may export differently — mapping UI lets user pick the right column to mitigate
- **Daily bucketing:** If Adjust CSV has daily rows, aggregation must sum correctly — covered by `aggregateByCapaignId`
- **Large CSV files:** PapaParse streams efficiently in browser — no issue for typical ad accounts

## Security Considerations
- CSV processed entirely client-side — no revenue data leaves the browser
- No server storage of Adjust data (ephemeral per session)

## Next Steps
→ Phase 04: Wire CSV upload + merged data into the dashboard UI
