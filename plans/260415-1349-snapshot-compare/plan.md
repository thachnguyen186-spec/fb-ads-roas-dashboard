---
title: "Dashboard Snapshot & Compare"
description: "Save campaign+adset metric snapshots, compare current vs saved ROAS/Profit"
status: pending
priority: P2
effort: 3h
branch: master
tags: [dashboard, snapshots, compare, supabase]
created: 2026-04-15
---

# Dashboard Snapshot & Compare

## Overview
Allow users to save a named snapshot of the current dashboard metrics (campaigns + adsets) to Supabase. Later, select a saved snapshot to compare against current data — 4 extra columns appear: Old ROAS, Old %Profit, ΔROAS, Δ%Profit.

## Phases

| # | Phase | Status | File |
|---|-------|--------|------|
| 1 | DB migration + types | pending | [phase-01](phase-01-db-and-types.md) |
| 2 | API routes | pending | [phase-02](phase-02-api-routes.md) |
| 3 | Snapshot toolbar component | pending | [phase-03-ui-toolbar.md](phase-03-ui-toolbar.md) |
| 4 | Compare columns in table + adsets | pending | [phase-04-compare-columns.md](phase-04-compare-columns.md) |

## Key Dependencies
- Supabase service client (`lib/supabase/server.ts`)
- `MergedCampaign`, `MergedAdSet` types from `lib/types.ts`
- `loadAllAdsets` logic in `campaign-hub.tsx`
- `campaign-table.tsx`, `adset-rows.tsx`, `adset-flat-view.tsx` for extra columns
