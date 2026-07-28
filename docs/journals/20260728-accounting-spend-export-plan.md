# Accounting Spend Export Tool: Planning Complete + 15 Red-Team Fixes Applied

**Date**: 2026-07-28 08:48
**Component**: Accounting Export Dashboard (new tool)
**Status**: Ready for Implementation (Phase 01–06 planned, no code written)

## What Happened

Completed full-cycle planning and red-team review for a new accounting export tool: admin/leader-only access to download all FB + TikTok ad spend over any time range, in native currency, with resolved campaign targets (app/domain), owner grouping, and CSV export. Workflow: research → scope clarification → planner delegation → 4-lens red-team review (Security Adversary, Failure Mode Analyst, Assumption Destroyer, Scope & Complexity Critic) → validation interview.

## Planning Discoveries

**Research phase identified two pre-existing bugs** that would have silently degraded the export:
1. `fetchCampaigns` status-filtering logic would exclude archived campaigns, losing historical spend
2. No FB destination-URL field extraction pattern existed for campaign-web conversions (found workaround in existing `campaign-csv-export.ts`)

**Scope clarification with user** resolved 4 ambiguities: data precision (per-campaign, not daily), grouping model (org-wide account → owner mapping, editable in-app), access (initially "any authenticated user" — this was revised by red-team findings), TikTok date-range support (1-year max per API constraints).

## Critical Red-Team Convergence

Two independent findings surfaced the same vulnerability: the planner's draft had **zero RBAC on the TikTok read leg** (any authenticated staff member would see org-wide spend across every department, while FB was carefully scoped). The Security Adversary flagged this as financial-data leakage; the Scope Critic independently flagged full staff/leader/admin visibility branches as speculative (only an admin/leader-provisioned accountant will use this). **Result:** entire tool gated to admin/leader only (staff get 403). This was an access-model reversal from the user's initial preference, surfaced via the red-team process, not silently overridden.

## Other High-Value Fixes (14 more)

- CSV injection guard: `owner_label` beginning with `=`/`+`/`-`/`@`/tab gets prefixed `'`
- Destination-URL resolution: prefer highest-impression ad instead of "first ad wins" (UI caveat: label is one observed target, not authoritative)
- TikTok parity: archived/deleted campaigns included in historical export (mirrors FB fix)
- Partial-visibility signal: `coverage` field (e.g. "Showing spend for 12 of 12 users") prevents silent data gaps from `listUsers` errors
- Concurrent API legs (FB + TikTok run in parallel, not serial)
- Per-user rate-limit cooldown (10s, in-memory — acceptable for trusted admin/leader audience)
- Hard 5,000-row ceiling with UI warning
- TikTok target resolver now sends `fields` param for reliable app_id/promotion_type/landing_page_url extraction

## Validation Interview

4 implementation-level thresholds confirmed: in-memory rate limit (kept), TikTok 'maximum' lookback bound revised from 2 years to **1 year** (only edit to plan), group-by-owner UI + separate management panel (kept — user explicitly wants editable grouping), 5k-row ceiling (kept).

## Effort & Next Steps

Red-team fixes raised estimate from 15h → **18h** (parallelization rework, coverage signaling, live API verification). No code written. Plan is frozen; proceeding directly to Phase 01 implementation.

**Lesson:** Pre-implementation red-team review (especially on access control + edge cases) catches reversals better than post-code review. The security + scope convergence on access gating would have failed QA otherwise.
