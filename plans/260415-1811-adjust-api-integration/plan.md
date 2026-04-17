---
title: "Adjust Report API Integration"
description: "Add Adjust API token-based data fetching as primary source, CSV upload as fallback"
status: pending
priority: P1
effort: 4h
branch: master
tags: [adjust, api, integration, roas]
created: 2026-04-15
---

# Adjust Report API Integration

## Goal
Replace manual Adjust CSV upload with API-based fetch as the **primary** data source. CSV upload remains as **fallback**. Both paths produce identical `AdjustRow[]` output — merge pipeline stays untouched.

## Data Flow

```
[Phase 1] Settings UI → PATCH /api/settings → profiles.adjust_api_token (Supabase)

[Phase 2] GET /api/adjust/revenue → read token from profiles → call Adjust CSV Report API
         → parse CSV response → map to AdjustRow[] → return JSON

[Phase 3] Dashboard: hasAdjustToken?
           YES → "Fetch from Adjust API" button → GET /api/adjust/revenue → AdjustRow[]
           NO  → CSV upload only (current behavior)
         Both paths → same aggregation functions → same merge pipeline → MergedCampaign[]
```

## Architecture Constraints
- **ZERO changes** to `lib/adjust/csv-parser.ts`, `lib/adjust/merge.ts`, `lib/types.ts`
- Token never sent to browser — only `has_adjust_token: boolean` exposed
- Server-side route is sole consumer of token + Adjust API caller
- CSV upload always accessible (secondary when API available)

## Phases

| # | Phase | File | Status | Effort |
|---|-------|------|--------|--------|
| 1 | [Token Storage & Settings](./phase-01-token-storage-settings.md) | schema.sql, settings route, settings UI | Pending | 1h |
| 2 | [Adjust API Client & Route](./phase-02-adjust-api-client.md) | new: api-client.ts, revenue route | Pending | 1.5h |
| 3 | [Dashboard Dual-Mode Fetch](./phase-03-dashboard-dual-mode.md) | campaign-hub.tsx, dashboard page.tsx | Pending | 1.5h |

## Dependency Graph
```
Phase 1 ──→ Phase 2 ──→ Phase 3
(token)     (API)       (UI)
```
Phase 2 needs the token stored (Phase 1). Phase 3 needs the API route (Phase 2) + `has_adjust_token` prop (Phase 1).

## Risk Summary

| Risk | L x I | Mitigation |
|------|-------|------------|
| Adjust API column names differ from CSV export | Med x High | Phase 2 maps columns explicitly; fallback to 0 for missing `cohort_all_revenue` |
| `partner_name` value mismatch (e.g. "Facebook Ads" vs "facebook") | Med x Med | Case-insensitive match, check both known variants |
| Rate limiting on Adjust API | Low x Med | Single call per analyze action; no polling |
| Token stored in plaintext in Supabase | Low x Med | Same pattern as existing `fb_access_token`; RLS prevents cross-user reads; service client only |

## Rollback Plan
- Phase 1: `ALTER TABLE profiles DROP COLUMN adjust_api_token;` + revert settings route/UI
- Phase 2: Delete 2 new files (`api-client.ts`, `revenue/route.ts`)
- Phase 3: Revert `campaign-hub.tsx` and `page.tsx` to remove `hasAdjustToken` prop + API fetch path

Each phase is independently revertible. Phase 3 removal leaves Phase 1+2 inert but harmless.

## Test Matrix

| Layer | What | How |
|-------|------|-----|
| Unit | `fetchAdjustRevenueToday()` parses sample CSV, maps columns, filters Facebook rows | Jest with mocked fetch |
| Unit | Settings PATCH accepts/stores `adjust_api_token` | Existing settings test pattern |
| Integration | `/api/adjust/revenue` returns `AdjustRow[]` matching CSV upload output | Compare API output vs `parseAdjustCsv()` on same data |
| E2E | Full flow: configure token → fetch from API → see ROAS table | Manual verification |

## Success Criteria
- [ ] User can save/remove Adjust API token in Settings (same UX as FB token)
- [ ] "Fetch from Adjust API" button appears when token is configured
- [ ] API fetch produces identical `AdjustRow[]` to CSV upload for same date/data
- [ ] Merge pipeline + ROAS table render identically regardless of data source
- [ ] CSV upload remains functional as fallback
- [ ] Token never appears in browser network tab or client-side code
