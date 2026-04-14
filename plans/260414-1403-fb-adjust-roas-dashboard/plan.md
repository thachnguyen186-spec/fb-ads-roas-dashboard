---
title: "FB Ads + Adjust ROAS Dashboard"
description: "Campaign dashboard merging FB Marketing API data with Adjust CSV to compute ROAS and trigger manual actions"
status: pending
priority: P1
effort: 10h
branch: main
tags: [facebook-api, adjust, roas, campaigns, next-js, supabase]
created: 2026-04-14
---

# FB Ads + Adjust ROAS Dashboard

New workspace section inside `C:\Work\Tools\fb-ads-tool` that gives the user a single view of Facebook campaign performance merged with Adjust revenue data, enabling manual campaign actions (pause, budget change, duplicate).

## Research
- [FB Marketing API report](./research/researcher-fb-api-report.md)
- [CSV parsing + ROAS merge report](./research/researcher-csv-roas-report.md)

## Phases

| # | Phase | Status | Est. |
|---|-------|--------|------|
| 1 | [DB Schema + FB Settings](./phase-01-db-settings.md) | pending | 1h |
| 2 | [FB API Integration + Campaigns Route](./phase-02-fb-api-campaigns.md) | pending | 2h |
| 3 | [Adjust CSV Upload + ROAS Merge](./phase-03-adjust-csv-merge.md) | pending | 2.5h |
| 4 | [Campaign Dashboard UI](./phase-04-campaign-dashboard-ui.md) | pending | 3h |
| 5 | [Campaign Actions (Pause + Budget)](./phase-05-campaign-actions.md) | pending | 1.5h |
| — | Duplicate campaign action | future | — |

## Key Dependencies
- Phase 1 must complete before all others (DB schema + Workspace type)
- Phase 2 must complete before Phase 4 (data source)
- Phase 3 must complete before Phase 4 (Adjust merge)
- Phase 4 must complete before Phase 5 (action buttons live in UI)

## Validation Summary

**Validated:** 2026-04-14
**Questions asked:** 6

### Confirmed Decisions
- **Adjust CSV format:** Unknown until user provides example file — column mapping UI remains fully flexible (fuzzy auto-detect)
- **Date range default:** `today` with visible warning about FB insights 6–48h delay
- **Campaign actions scope (MVP):** Pause + budget only — duplicate moved to future phase
- **Budget input:** Absolute value + percentage-change quick buttons (−20%, +20%, +50%)

### Workflow Clarification (post-validation)
- **On-demand trigger:** Page loads empty. FB data is crawled only when user clicks "Analyze" (not on page load)
- **Ephemeral sessions:** All merged data lives in React state. Page refresh = clean slate. No persistence needed
- **Always today:** No date picker — always fetches today's FB data with a partial-data warning banner

### Action Items
- [x] Adjust CSV format confirmed from real export — fixed schema, no column mapper needed
- [x] Phase 04: Updated to on-demand Analyze workflow with state machine (idle→csv_ready→analyzing→results)
- [x] Phase 05: Duplicate removed from scope; budget modal has absolute + ±% quick buttons
- [x] Phase 02: FB API route fixed to `date_preset=today` only

### Adjust CSV Schema (confirmed 2026-04-14)
```
Columns: app, channel, campaign_network, campaign_id_network,
         adgroup_network, adgroup_id_network, cost, all_revenue, cohort_all_revenue
Join key:  campaign_id_network  (FB campaign ID)
Revenue:   cohort_all_revenue   (period-specific, NOT all_revenue which is lifetime)
Filter:    channel === 'Facebook', skip 'unknown'/'Expired Attributions' IDs
Aggregate: SUM cohort_all_revenue per campaign_id_network (rows are ad-set level)
Multi-app: optional app filter dropdown in UI
```

---

## Architecture Summary
```
Settings page → store FB token + ad account ID in workspaces table
                           ↓
              /api/workspaces/[id]/campaigns (GET)
                           ↓
              lib/facebook/campaigns.ts → FB Marketing API v21
                           ↓
         Dashboard page: FB campaigns + Adjust CSV upload (PapaParse)
                           ↓
              lib/adjust/merge.ts → left join by campaign_id → ROAS
                           ↓
         CampaignTable → ROAS filter → ActionBar → FB API PATCH/POST
```
