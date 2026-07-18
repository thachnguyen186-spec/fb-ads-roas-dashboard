---
title: "TikTok Ads Tab Foundation"
description: "Add TikTok Ads as a second platform via a dashboard tab — OAuth connect, read campaigns/ad groups, budget + on/off parity with Facebook, Adjust revenue wired to TikTok."
status: pending
priority: P1
effort: 16h
branch: master
tags: [tiktok-api, oauth, dashboard, integration, multi-platform]
blockedBy: []
blocks: []
created: 2026-07-18
---

# TikTok Ads Tab Foundation

## Overview

App currently manages Facebook Ads only (`app/dashboard`), with revenue merged from Adjust (`lib/adjust/`). This plan adds TikTok Ads management as a second platform, reachable via a tab from the FB dashboard, with **independent data loading** (TikTok tab never fetches/holds FB data and vice versa — enforced structurally by separate Next.js routes).

Scope = **Plan 1 of 2** (user-approved split). Plan 1 = TikTok tab foundation: OAuth connect, read campaigns/ad groups, budget edit + on/off toggle parity with Facebook, Adjust revenue wired to TikTok. **Plan 2 (future, not in this plan)** = duplicate-campaign + creative/targeting/bidding wizard — deferred until Plan 1 ships. Plan 1 type shapes store campaign/adgroup fields separately so Plan 2 is not boxed in.

Auth model: **single org-wide TikTok connection** (not per-user like FB's pasted token) — mirrors the existing org-wide Adjust token pattern. One admin/leader authorizes once; all users see the same advertiser accounts. Tokens stored in a DB table (access_token expires every 24h → lazy on-demand refresh), not env vars.

## Manual Prerequisites (non-code, block live testing)

- TikTok Developer Portal → whitelist real production callback URL `{PROD_URL}/api/tiktok/oauth/callback` (currently placeholder `giftago.co`). Blocks Phase 2 end-to-end testing.
- Confirm exact OAuth scope IDs to request in the Portal (undocumented — see Unresolved).
- Verify Adjust's exact `partner_name` string for TikTok traffic before hardcoding it (Phase 1 — do NOT guess).

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [TikTok API Client + Database Schema](./phase-01-tiktok-api-client-and-database-schema.md) | Complete (2026-07-18) |
| 2 | [OAuth Connect Flow + Settings UI](./phase-02-oauth-connect-flow-and-settings-ui.md) | Complete (2026-07-18) |
| 3 | [TikTok Dashboard Tab: Read-Only View + Adjust Revenue](./phase-03-tiktok-dashboard-tab-read-only-view.md) | Complete (2026-07-18) |
| 4 | [Control Parity: Budget Edit + On/Off Toggle](./phase-04-control-parity-budget-edit-and-toggle.md) | Pending |

## Dependencies

- Phase 1 → blocks all others (types, client, schema, Adjust generalization are foundational).
- Phase 2 → depends on Phase 1 (connection table + client).
- Phase 3 → depends on Phase 1 for types/client; Phase 2 for real data (UI buildable against mocked/error states first).
- Phase 4 → depends on Phase 3 (extends the TikTok hub + tables).
- External: TikTok Business API v1.3; existing Adjust Reports API integration; Supabase (service-role writes).

## Reference Reports

- [TikTok Auth + Control + Reporting](../reports/researcher-260718-0920-tiktok-api-auth-control.md)
- [TikTok Campaign/Creative Creation](../reports/researcher-260718-0926-tiktok-api-campaign-creative.md)

## Next Steps (forward pointer — Plan 2, not yet a plan dir)

- Duplicate-campaign (client-side orchestration — TikTok has no native deep-copy).
- Creative upload + targeting/bidding wizard (campaign/adgroup/ad create endpoints).
- Store campaign/adgroup/ad fields separately now so Plan 2 create-flow reuses them.

## Red Team Review

### Session — 2026-07-18
**Reviewers:** Security Adversary, Assumption Destroyer, Failure Mode Analyst (3, per the 4-phase scale)
**Findings:** 23 raw → 15 after dedup (8 Critical/dupe-merged, 4 rejected-as-redundant covered under other findings)
**Severity breakdown:** 3 Critical, 8 High, 4 Medium
**Disposition:** All 15 Accepted and applied inline (marked 🔴 in each phase file)

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | Control-plane PATCH routes (pause/enable/budget) had no role gate on the shared org-wide credential | Critical | Accept | Phase 4 |
| 2 | OAuth connect/re-auth gated to admin+leader; should be admin-only (leader can hijack the org-wide singleton) | Critical | Accept | Phase 2 |
| 3 | ROAS/Profit divides native-currency TikTok spend by USD Adjust revenue with no FX conversion | Critical | Accept | Phase 1, Phase 3 |
| 4 | Token refresh doesn't persist a rotated `refresh_token`; concurrent-refresh race dismissed too lightly | High | Accept | Phase 1 |
| 5 | Unbounded parallel advertiser fan-out contradicts the plan's own 429 mitigation + multiplies token-refresh races | High | Accept | Phase 1, Phase 3 |
| 6 | TikTok reporting lag (24-48h) likely makes "today" spend empty, not just partial — understated | High | Accept | Phase 1, Phase 3 |
| 7 | TikTok dashboard read access had no role check | High | Accept (documented as intentional — read open to all authenticated users, write role-gated) | Phase 3 |
| 8 | Disconnect deletes the local DB row but never revokes the token at TikTok | High | Accept | Phase 2 |
| 9 | Advertiser-list hygiene on reconnect/disconnect was self-contradictory (is_selected reset) and incomplete (no stale-row cleanup, "optional" account clearing) | High | Accept | Phase 2 |
| 10 | Reintroduces the exact UTC-vs-Bangkok day-boundary bug just fixed for the FB/Adjust integration | High | Accept | Phase 1, Phase 3 |
| 11 | Budget-minimum validation ignored TikTok's LIFETIME-mode dynamic minimum formula | High | Accept | Phase 4 |
| 12 | No explicit guard against serializing `access_token`/`refresh_token` into API responses | Medium | Accept | Phase 1, Phase 2 |
| 13 | No server-side check that a campaign/ad-group actually belongs to the supplied `advertiser_id` | Medium | Accept | Phase 4 |
| 14 | Adjust's numeric-only campaign-ID filter (built for FB IDs) never verified for TikTok — a second silent-drop risk | Medium | Accept | Phase 1 |
| 15 | Bulk pause/enable had undefined partial-failure semantics for a cost-control action | Medium | Accept | Phase 4 |

Two lower-priority observations noted but not tracked as numbered findings (folded into existing risk rows rather than given dedicated fixes): proactive health-monitoring/alerting for the org-wide connection's refresh-token age (nice-to-have hardening, not a Plan-1 blocker), and the plan's original "mirrors the existing Adjust token pattern" framing understated that this is the codebase's first rotating-OAuth-token table (corrected via the findings above, which treat it with appropriate scrutiny rather than as low-risk-by-precedent).

## Validation Log

### Session 1 — 2026-07-18
**Trigger:** Post-red-team validation interview (user opted in)
**Questions asked:** 4

#### Questions & Answers

1. **[Architecture]** Phase 1's currency fix left non-USD TikTok advertiser accounts as an open question — which approach should the plan commit to?
   - Options: Restrict to USD-only for now (Recommended) | Allow any currency, skip ROAS math for non-USD | Build real FX conversion now
   - **Answer:** Restrict to USD-only for now
   - **Rationale:** Simplest, zero risk of wrong ROAS math, defers FX conversion entirely rather than building either a partial-skip UX or real conversion logic for Plan 1.

2. **[Tradeoffs]** The red-team fix restricted TikTok OAuth connect/reconnect/disconnect to admin-only (was admin+leader) — confirm this policy?
   - Options: Keep admin-only for connect/disconnect (Recommended) | Revert to admin+leader for connect too
   - **Answer:** Keep admin-only for connect/disconnect
   - **Rationale:** Matches the codebase's existing RBAC convention (admin = org-wide mutations). Leaders retain day-to-day campaign control (pause/budget, Phase 4) and advertiser-selection toggling (Phase 2).

3. **[Assumptions]** TikTok's reporting API likely returns little/no data for "today" (24-48h lag) — how should the dashboard handle this?
   - Options: Show today's column with a lag note (Recommended) | Default to showing yesterday's full-day numbers
   - **Answer:** Show today's column with a lag note
   - **Rationale:** Simplest for Plan 1; avoids the bigger UX restructuring a yesterday-primary view would need. Revisit if users find the near-empty "today" column confusing in practice.

4. **[Risks]** If a bulk pause/enable action partially fails, how should the app respond?
   - Options: Report failures, manual retry (Recommended) | Auto-retry failed chunks once before reporting
   - **Answer:** Report failures, manual retry
   - **Rationale:** Simplest, matches what the red-team fix already specified; avoids added retry-logic complexity in Phase 4 for Plan 1.

#### Confirmed Decisions
- Currency scope: USD-only advertiser accounts for Plan 1 — no FX conversion built; enforced in Phase 2's account-selection UI/route, not just documented as a risk.
- OAuth connect/disconnect: `admin`-only (day-to-day control stays `admin`+`leader`).
- Reporting lag UX: today's column stays primary, with an inline lag-warning note.
- Bulk action failures: explicit "X of N failed" reporting, no auto-retry.

#### Action Items
- [x] Phase 1: `merge.ts` simplified to USD-only (no FX conversion code path); defensive currency check only.
- [x] Phase 2: `accounts` PATCH route rejects `is_selected=true` for non-USD advertisers; Settings UI disables non-USD checkboxes with a tooltip.
- [x] Phase 3: removed the "N/A (non-USD)" badge UI (no longer reachable); kept the reporting-lag inline note as the primary "today" UX.
- [x] Phase 4: bulk action reconciliation already specified as report-only (no change needed).

#### Impact on Phases
- Phase 1: Key Insights, Architecture (merge flow), Implementation Step 7, Todo, Success Criteria, Risk Assessment — all updated to USD-only framing.
- Phase 2: Requirements, Implementation Steps 5 — added USD-only enforcement.
- Phase 3: Fetch/merge data flow diagram, Implementation Step 4, Todo, Success Criteria — updated to remove non-USD badge, confirm today-primary UX.
- Phase 4: no change (bulk-failure handling already matched the confirmed decision).
