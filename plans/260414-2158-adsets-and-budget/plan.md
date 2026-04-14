---
title: "Collapsible Ad Sets + Ad Set Budget Management"
description: "Expand campaigns to show ad set sub-rows with ROAS; budget edit for campaigns and ad sets"
status: completed
priority: P1
effort: 6h
branch: feat/adsets-and-budget
tags: [adsets, budget, dashboard, fb-api]
created: 2026-04-14
completed: 2026-04-14
---

# Ad Sets Expansion + Budget Management

## Goal
1. Campaign rows expand to reveal ad set sub-rows (lazy-loaded from FB API, merged with Adjust revenue by adgroup_id)
2. Budget column visible on both campaign and ad set rows, editable via existing BudgetModal

## Data Flow

```
Adjust CSV ──parse──► AdjustAdSetRow[] ──aggregateByAdSetId──► Map<adset_id, revenue>
                                        ──aggregateByCampaignId──► Map<campaign_id, revenue>  (existing)

User clicks ▶ on campaign row
  └──► GET /api/campaigns/[campaignId]/adsets
         └──► FB GET /{campaignId}/adsets?fields=...&insights.date_preset(today){...}
         └──► returns AdSetRow[]

Client merges AdSetRow[] + adjustAdSetMap ──► MergedAdSet[] (with ROAS)

User clicks "Edit budget" on ad set row
  └──► PATCH /api/adsets/[adsetId] { action: 'budget', budget_type, amount_usd }
         └──► FB PATCH /{adsetId} { daily_budget: cents }
```

## Phases

| # | Phase | Files Created/Modified | Status |
|---|-------|----------------------|--------|
| 1 | [Types + Adjust ad set aggregation](phase-01-types-and-adjust-adsets.md) | `lib/types.ts`, `lib/adjust/csv-parser.ts` | Completed |
| 2 | [FB ad sets API + route](phase-02-fb-adsets-api.md) | `lib/facebook/adsets.ts` (new), `lib/facebook/adset-actions.ts` (new), `app/api/campaigns/[campaignId]/adsets/route.ts` (new), `app/api/adsets/[adsetId]/route.ts` (new) | Completed |
| 3 | [Collapsible table UI](phase-03-collapsible-table-ui.md) | `app/dashboard/components/campaign-table.tsx`, `app/dashboard/components/campaign-hub.tsx`, `app/dashboard/components/adset-rows.tsx` (new) | Completed |
| 4 | [Budget column + ad set budget edit](phase-04-budget-adsets.md) | `app/dashboard/components/campaign-table.tsx`, `app/dashboard/components/budget-modal.tsx`, `app/dashboard/components/action-bar.tsx` | Completed |

## Dependency Graph
```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4
(types)    (API)       (UI expand)  (budget UI)
```
Phase 1 is prerequisite for all. Phase 3 depends on Phase 2 (needs API). Phase 4 depends on Phase 3 (needs ad set rows rendered).

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| FB rate limiting on ad set fetch | Medium | Medium | Lazy-load only on expand; cache in state; one campaign at a time |
| Adjust CSV missing adgroup_id_network | Low | High | Graceful fallback: show "No match" for ad sets without Adjust data |
| Budget modal type mismatch (campaign vs ad set) | Low | Medium | Generalize modal Props to accept a budget-bearing entity interface |
| Large ad set count per campaign | Low | Low | FB paginates at 100; implement cursor pagination same as campaigns |

## Backwards Compatibility
- No existing data/API contracts broken
- Campaign table keeps all current columns/behavior
- BudgetModal Props extended (not replaced) via union type
- Adjust CSV parse still returns campaign-level data; ad set aggregation is additive

## Rollback
Each phase is independently revertable via git revert. No DB migrations involved.

## Test Matrix

| Layer | What | How |
|-------|------|-----|
| Unit | `aggregateByAdSetId()` | Jest: known CSV rows -> expected map |
| Unit | `mergeAdSets()` | Jest: FB rows + adjust map -> correct ROAS |
| Unit | `centsToUsd`, budget type resolution for ad sets | Jest |
| Integration | GET /api/campaigns/[id]/adsets | Mock FB response, verify shape |
| Integration | PATCH /api/adsets/[id] | Mock FB, verify cents conversion |
| E2E | Expand campaign, see ad sets, click budget | Manual smoke test |
