# Phase 04 — Campaign Dashboard UI

## Context Links
- Parent plan: [plan.md](./plan.md)
- Phase 02 (data source): [phase-02-fb-api-campaigns.md](./phase-02-fb-api-campaigns.md)
- Phase 03 (merge/CSV): [phase-03-adjust-csv-merge.md](./phase-03-adjust-csv-merge.md)
- Workspace layout: `C:\Work\Tools\fb-ads-tool\app\workspaces\[id]\layout.tsx`
- Research page pattern: `C:\Work\Tools\fb-ads-tool\app\workspaces\[id]\research\page.tsx`

## Overview
- **Date:** 2026-04-14
- **Priority:** P1
- **Status:** pending (requires Phase 02 + 03)
- **Description:** Build the Campaigns page with an on-demand "Analyze" workflow. Page loads empty. User uploads Adjust CSV, clicks Analyze — FB today's data is crawled at that moment, merged with CSV, and shown in the table. All state is ephemeral (React state only); page refresh = clean slate.

## Key Insights
- **On-demand workflow:** Page loads as an empty shell — no pre-fetch. FB data is crawled only when user clicks "Analyze"
- **Ephemeral state:** All merged data lives in React state only. Page refresh = clean slate. No DB storage of results
- **No date picker:** Always fetches today's data (`date_preset=today`). FB insights are partial for today — show warning banner
- ROAS filter: two number inputs (min ROAS, max ROAS) — filter applied client-side on merged data
- Sorting: click column headers to sort (campaign name, spend, ROAS, status)
- Row selection: checkboxes for bulk actions (handled in Phase 05)
- Empty states: initial (no CSV yet), loading (Analyze in progress), results, no token configured

## Requirements
- Server page at `app/workspaces/[id]/campaigns/page.tsx` — lightweight, just auth + workspace check, no data fetch
- Client hub component `CampaignHub` orchestrates all state and the Analyze trigger
- `CampaignTable` renders sorted/filtered rows with checkboxes
- `RoasFilter` controls (min/max inputs) — only visible after results load
- `AdjustCsvUpload` + `ColumnMapper` from Phase 03 wired in
- Responsive table with horizontal scroll on mobile

## Architecture

```
USER FLOW:
  1. Open Campaigns page → empty state ("Upload your Adjust CSV to begin")
  2. Upload Adjust CSV → ColumnMapper appears (map campaign_id + revenue cols)
  3. Click "Analyze" → parallel:
       a. fetch /api/workspaces/[id]/campaigns?date_preset=today  (FB crawl)
       b. parseAdjustCsv(file, mapping)                          (client-side)
  4. mergeCampaigns(fbData, adjustData) → MergedCampaign[]
  5. Table appears with ROAS + action controls
  (Page refresh → back to step 1, fresh slate)

page.tsx (server component — minimal)
  → auth + workspace fetch
  → pass { workspaceId, hasFbConfig } to CampaignHub (no data fetch)

CampaignHub (client component, manages all state)
  ├── state: phase = 'idle' | 'csv_ready' | 'analyzing' | 'results' | 'error'
  ├── state: parsedAdjust (AdjustRow[]), columnMapping
  ├── state: mergedCampaigns (MergedCampaign[])
  ├── state: roasMin, roasMax, sortCol, sortDir, selectedIds
  │
  ├── [idle] AdjustCsvUpload → file selected → ColumnMapper
  ├── [csv_ready] "Analyze" button (primary CTA)
  ├── [analyzing] Loading spinner + "Fetching today's Facebook data..."
  ├── [results]
  │     ├── Warning banner: "⚠ Today's FB data may be incomplete (insights delay)"
  │     ├── Stats bar: total campaigns, total spend, avg ROAS
  │     ├── RoasFilter (min/max inputs)
  │     ├── CampaignTable (checkbox, name, status, spend, CPM, CPC,
  │     │                  daily_budget, adj_revenue, ROAS)
  │     └── ActionBar (Phase 05) — when selectedIds.size > 0
  └── [error] Error message + "Try again" button
```

## Column Layout

| Column | Source | Format |
|--------|--------|--------|
| Campaign name | FB | text, truncated |
| Status | FB | badge (ACTIVE/PAUSED) |
| Spend | FB insights | `$1,234.56` |
| Impressions | FB insights | `1,234,567` |
| CPM | FB insights | `$12.34` |
| CPC | FB insights | `$0.45` |
| Daily budget | FB | `$500.00` or `—` |
| Adj. Revenue | Adjust CSV | `$2,345.67` or `—` |
| ROAS | Computed | `2.45x` color-coded or `—` |

## Related Code Files

**Create:**
- `C:\Work\Tools\fb-ads-tool\app\workspaces\[id]\campaigns\page.tsx`
- `C:\Work\Tools\fb-ads-tool\app\workspaces\[id]\campaigns\components\campaign-hub.tsx`
- `C:\Work\Tools\fb-ads-tool\app\workspaces\[id]\campaigns\components\campaign-table.tsx`
- `C:\Work\Tools\fb-ads-tool\app\workspaces\[id]\campaigns\components\roas-filter.tsx`

**Reuse from Phase 03:**
- `adjust-csv-upload.tsx` (includes optional app filter)

**Not needed:**
- `column-mapper.tsx` — eliminated (fixed Adjust schema)
- `date-preset-selector.tsx` — eliminated (always today)

## Implementation Steps
1. Create `page.tsx` (server component — minimal):
   - Auth + workspace ownership check only
   - Pass `workspaceId` + `hasFbConfig` to `CampaignHub`
   - No data fetching — all data fetch happens client-side on Analyze

2. Create `campaign-hub.tsx` (client component):
   - State machine: `idle → csv_ready → analyzing → results | error`
   - On CSV uploaded + mapping confirmed → set `parsedAdjust` + transition to `csv_ready`
   - On "Analyze" click:
     - Transition to `analyzing`
     - `Promise.all([fetch('/api/.../campaigns?date_preset=today'), parseAdjustCsv(file, mapping)])`
     - On success → `mergeCampaigns(fb, adjust)` → set `mergedCampaigns` → transition to `results`
     - On error → transition to `error` with message
   - Apply ROAS filter + sort before passing to `CampaignTable`
   - Track `selectedIds: Set<string>` — pass to `CampaignTable` and `ActionBar`

3. Create `campaign-table.tsx`:
   - `<table>` with sticky header, horizontal scroll wrapper
   - Column header click → toggle sort
   - Each row: checkbox + campaign data cells
   - ROAS cell: color-coded via `computeRoasColor(roas)` → Tailwind class

4. Create `roas-filter.tsx`:
   - Two number inputs: "Min ROAS" and "Max ROAS" (empty = no limit)
   - Only rendered in `results` phase

## Todo List
- [ ] Create `page.tsx` server component
- [ ] Create `campaign-hub.tsx` with state management
- [ ] Create `campaign-table.tsx` with sorting + checkboxes
- [ ] Create `roas-filter.tsx`
- [ ] Create `date-preset-selector.tsx`
- [ ] Wire AdjustCsvUpload into hub
- [ ] Test: verify table renders with live FB data, CSV upload merges correctly

## Success Criteria
- Campaigns page loads and displays live FB campaign data
- Uploading Adjust CSV shows ROAS column with color coding
- ROAS filter narrows visible campaigns
- Sorting by any column works
- Selecting rows shows action bar (stub for Phase 05)
- No-FB-config state shows helpful callout with link to Settings

## Risk Assessment
- **Re-fetch on date change:** Must not lose Adjust merge state when re-fetching — hub re-merges new FB data with current `adjustMap` in state
- **Large tables:** 100+ campaigns — use `useMemo` for filter/sort to avoid re-renders

## Security Considerations
- No sensitive data rendered client-side (token stays server-side)
- Campaign IDs in row checkboxes are not sensitive

## Next Steps
→ Phase 05: Implement action buttons (pause, budget, duplicate) using selected campaign IDs
