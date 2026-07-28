---
title: "Accounting Export Tool"
description: "New Tool Hub tool for accountants: export all FB + TikTok ad spend over a time range, in original currency, with campaign/account/target/owner columns, CSV export, and an editable org-wide account→owner grouping."
status: completed (code complete; DB migration + live TikTok field verification are manual follow-ups)
priority: P1
effort: 18h
branch: master
tags: [accounting, export, csv, fb-api, tiktok-api, multi-platform, rbac]
created: 2026-07-28
---

# Accounting Export Tool

A standalone tool (`/accounting-export`, reachable from the Tool Hub) that lets an accountant export **all ad spend** across Facebook and TikTok for any time range. Each row carries: platform, account id + name, campaign name, spend in the account's **original currency** (never FX-converted), the resolved target (app name / app id / website domain), and a free-text owner/department label. Rows are filterable/sortable/groupable client-side and exportable to CSV.

## Access model (admin/leader only, role-scoped visibility)

**[Red Team Fix #1]** The whole tool is gated to **admin + leader** only — `staff` get 403 (routes) / redirect to `/tools` (page). This corrects an inconsistent, unintended posture where the TikTok read leg would have exposed org-wide spend to any authenticated user while FB was carefully scoped; a financial-export tool must not leak cross-department spend to plain staff. It also drops speculative scope (full staff branches nobody will use).

Within that gate, visibility follows the existing RBAC model:
- **leader** → own + assigned team's FB accounts.
- **admin** → every FB account org-wide.
- **staff** → no access to this tool at all.
- **TikTok** (read + write) → visible to any admin/leader. TikTok has no per-user ownership model to scope by, so it is bounded by the admin/leader gate itself — not opened to everyone. `getVisibleUserIds`'s `staff` branch is kept (generic helper) but is unreachable via this tool.

**Operational note (not code scope):** for the accountant to see **all** spend org-wide she must be provisioned as an **admin** (or a **leader with the full team assigned**). That is an account-provisioning choice in the existing Admin UI.

## Architecture (one-shot data flow)

```
Browser (/accounting-export)   [admin/leader only — staff redirected to /tools]
  │  GET /api/accounting-export?since&until&datePreset&platform=facebook|tiktok|both
  ▼
Route: auth → requireRole(['admin','leader']) → per-user cooldown (429 if <10s) → getVisibleUserIds
       FB leg and TikTok leg run as two CONCURRENT top-level promises   [Red Team Fix #6]
  ├── FB leg: for each visible user → load fb_access_token + ALL fb_ad_accounts (ignore is_selected)
  │        flatten to (token, account) jobs → bounded concurrency (CONCURRENCY=3)
  │          fetchCampaigns(..., includeAllStatuses:true, dateParam)   ← native currency spend
  │          fetchCampaignAppIds(account)      → campaign_id → app_id
  │          fetchAppNames(appIds)             → app_id → app name
  │          fetchCampaignDestinations(account)→ campaign_id → website domain (app-less only)
  │
  └── TikTok leg: getValidAccessToken() ONCE → ALL tiktok_advertiser_accounts (ignore is_selected)
           bounded concurrency (CONCURRENCY=3)
             fetchCampaigns(...) + fetchSpend(..., dateParam)  ← native currency spend
             fetchCampaignTargets(advertiser)  → campaign_id → {app_id | website domain}
  │
  ▼  left-join account_owners (account_id, platform) → owner_label ; collect per-account warnings
  { rows, warnings, coverage:{role,visibleUserCount,totalOrgUserCount}, partial?, leg_aborted? }
     (rows hard-capped at 5,000 → truncate + warning  [Red Team Fix #15])
  ▼
Client hub: in-memory filter/sort/group → table → CSV (manual builder + BOM + formula-injection guard)

Grouping management (separate, same page):   [admin/leader only]
  GET  /api/account-owners  → every visible account (FB scoped, TikTok all) ⟕ account_owners
  PATCH /api/account-owners → upsert owner_label (FB: must be in visible set; TikTok: must exist;
                              both: stamp updated_by, trim+collapse label)
```

## Phases

| # | Phase | Status | File |
|---|-------|--------|------|
| 01 | DB schema + types + `getVisibleUserIds` helper | completed | [phase-01-db-schema-types-visibility-helper.md](./phase-01-db-schema-types-visibility-helper.md) |
| 02 | FB fetch fixes: `includeAllStatuses` + `campaign-destination.ts` | completed | [phase-02-fb-fetch-fixes-destination-resolver.md](./phase-02-fb-fetch-fixes-destination-resolver.md) |
| 03 | TikTok fetch fixes: date-ranged reporting + `campaign-target.ts` | completed | [phase-03-tiktok-date-range-target-resolver.md](./phase-03-tiktok-date-range-target-resolver.md) |
| 04 | Aggregate `/api/accounting-export` route (fan-out + resilience) | completed | [phase-04-aggregate-export-route.md](./phase-04-aggregate-export-route.md) |
| 05 | `/api/account-owners` GET + PATCH (scoped) | completed | [phase-05-account-owners-crud-routes.md](./phase-05-account-owners-crud-routes.md) |
| 06 | UI: page + hub + filter/table/CSV/grouping + Tool Hub card | completed | [phase-06-ui-page-hub-csv-tool-hub.md](./phase-06-ui-page-hub-csv-tool-hub.md) |

## Dependency Graph

```
01 ─┬─► 02 ─┐
    ├─► 03 ─┼─► 04 ─┐
    │       │       ├─► 06
    └───────┴─► 05 ─┘
```
- 02 & 03 depend on 01 (types) but are independent of each other → parallelizable.
- 04 depends on 01 (helper + types), 02 (FB fetchers) and 03 (TikTok fetchers).
- 05 depends on 01 (`getVisibleUserIds`, `account_owners` table) only → parallel with 02/03/04.
- 06 depends on 04 (export route) and 05 (owner routes).

## File Ownership (no overlap between phases)

| Phase | Files created/edited |
|-------|----------------------|
| 01 | `supabase/schema.sql`, `lib/types.ts`, `lib/auth-guards.ts` |
| 02 | `lib/facebook/campaigns.ts` (add param), `lib/facebook/campaign-destination.ts` (new) |
| 03 | `lib/tiktok/reporting.ts` (add `fetchSpend`), `lib/tiktok/campaign-target.ts` (new) |
| 04 | `app/api/accounting-export/route.ts` (new), `lib/accounting/build-rows.ts` (new) |
| 05 | `app/api/account-owners/route.ts` (new) |
| 06 | `app/accounting-export/page.tsx` + `components/*` (new), `lib/accounting/export-csv.ts` (new), `app/tools/page.tsx` (TOOLS array) |

Phase 04 & 05 both need `resolveDateParam` — Phase 02 does NOT touch `app/api/campaigns/route.ts`; instead Phase 04 exports/imports `resolveDateParam` from there (see Phase 04). Only Phase 04 edits `app/api/campaigns/route.ts` (adds one `export`). No two phases write the same file otherwise.

## Implementation Summary

**Status:** Code complete. All 6 phases implemented end-to-end.

**Files created/modified:**
- Phase 01: `supabase/schema.sql`, `lib/types.ts`, `lib/auth-guards.ts`
- Phase 02: `lib/facebook/campaigns.ts`, `lib/facebook/campaign-destination.ts`
- Phase 03: `lib/tiktok/reporting.ts`, `lib/tiktok/campaign-target.ts`
- Phase 04: `app/api/accounting-export/route.ts`, `lib/accounting/build-rows.ts`, `app/api/campaigns/route.ts` (export keyword only)
- Phase 05: `app/api/account-owners/route.ts`
- Phase 06: `app/accounting-export/page.tsx`, `app/accounting-export/components/accounting-export-hub.tsx`, `app/accounting-export/components/export-filter-bar.tsx`, `app/accounting-export/components/results-table.tsx`, `app/accounting-export/components/grouping-manager.tsx`, `lib/accounting/export-csv.ts`, `app/tools/page.tsx` (TOOLS array)

**Quality checks:**
- Typecheck: `npx tsc --noEmit` — passed
- Lint: `npm run lint` — passed
- Production build: `npm run build` — passed
- 3 small hardening fixes applied post-implementation:
  - Added `.error` checks on 3 Supabase selects in `app/api/accounting-export/route.ts`'s FB/TikTok legs
  - Wrapped `getVisibleUserIds` in a `resolveVisibleIds` try/catch helper in `app/api/account-owners/route.ts`
  - Switched `lib/accounting/build-rows.ts` date helpers from local-timezone to UTC `Date` getters
- Code review: 8/10 score, 0 critical / 1 high / 2 medium findings — all fixed pre-merge
- Smoke tests: routes tested for 401/403/redirect behavior, no 500s

**Outstanding manual steps (not blockers for merge):**
1. **DB migration:** Run the `create table account_owners` SQL in the Supabase SQL editor (per Phase 01 pattern — intentional manual step)
2. **Live TikTok field verification:** Verify `/adgroup/get/` field names (`app_id`, `promotion_type`, `landing_page_url`) against a live advertiser response and adjust if wrong (Phase 03, routine verification step)

## Cross-cutting decisions

- **Currency is never converted.** `spend` stays in each account's native currency; `currency` column labels it. Group subtotals sum only within the same currency; a mixed-currency group shows per-currency subtotals (no cross-currency sum — that would be a lie for accounting).
- **Query ALL accounts, not just `is_selected`.** Deliberate deviation from the live dashboard: deselecting an account for the live view must NOT hide its historical spend from an accounting export. Applies to both `fb_ad_accounts` and `tiktok_advertiser_accounts`.
- **`includeAllStatuses:true` for FB.** Historical exports must include archived/deleted campaigns (a campaign archived last month still spent money 3 months ago). Default `false` keeps every existing caller untouched. Final `.filter(spend > 0)` stays.
- **Partial-failure resilience.** One user's expired FB token or one advertiser's API error must NOT 500 the whole report — collect per-account failures into `warnings[]` and continue.
- **CSV built by hand.** Manual string builder + UTF-8 BOM + Blob download, mirroring `lib/spend-export.ts`. No new npm dependency (YAGNI).
- **`account_owners` = org-wide, service-role-only.** RLS enabled with **no policies**, mirroring `tiktok_advertiser_accounts`. The API route is the only enforcement point (checks `auth.getUser()` + scoping).
- **TikTok app label is the literal `app_id`.** No TikTok app-name lookup exists in this codebase; inventing one is out of scope (YAGNI). Honest `app_id` beats a fake name.

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Vercel function timeout on wide admin export (many users × accounts × creative lookups) | Med | High | Add `export const maxDuration = 60;` to the route. Bounded concurrency (3). Flag future chunking/pagination if org grows — do not build now (YAGNI). |
| TikTok ad-group field names (`app_id`, `promotion_type`, `landing_page_url`) unconfirmed | High | Med | Implement to best-guess names + `console.warn` fallback (mirrors `resolveStatus`). Verify against a live `/adgroup/get/` response early in Phase 03; adjust names if wrong. Non-blocking — routine for this codebase. |
| One user's FB token expired → whole report fails | Med | High | Per-account try/catch → push to `warnings[]`, continue. |
| Malformed / missing destination URL on FB creative | Med | Low | `new URL()` in try/catch; skip on throw; target falls back to `'unknown'`. |
| TikTok reporting lag (24–48h) understates very recent ranges | Med | Low | Accounting exports target closed past periods, not "today" — acceptable. Note in UI help text. |
| Mixed-currency subtotal misread as a single total | Med | Med | Never sum across currencies; render per-currency subtotal lines, labelled with the currency. |
| Cross-team owner-label tampering | Low | Med | **[Red Team Fix #1/#7]** Tool gated to admin/leader; PATCH verifies FB account in `getVisibleUserIds` set and TikTok account exists in `tiktok_advertiser_accounts`; every write stamps `updated_by`. |
| `getVisibleUserIds` admin path returns huge user list | Low | Med | `listUsers({ perPage: 200 })` like the admin route; acceptable at current org size. Revisit pagination if >200 users. |
| `listUsers` transient error silently scopes admin export to self | Med | High | **[Red Team Fix #5]** admin branch checks `.error` and throws (no silent `[userId]` fallback); route surfaces a `coverage` field so partial visibility is visible, not silent. |
| Repeated calls hammer FB's org-wide (app-level) rate limit, degrading the live dashboard | Med | High | **[Red Team Fix #8]** Per-user cooldown — reject a 2nd call within 10s → 429. |
| Systemic rate-limit cascade absorbed as many "harmless" per-account warnings | Med | High | **[Red Team Fix #12]** Abort a leg after 5 consecutive failures → `partial:true`/`leg_aborted`; UI shows a distinct red banner. |
| Aggregate row count explodes (admin × all accounts × archived × months) | Med | Med | **[Red Team Fix #15]** Hard 5,000-row ceiling → truncate + warning. No pagination in v1 (YAGNI). |
| Destination domain from "first ad" misrepresents whole-campaign spend | Med | Med | **[Red Team Fix #3]** Prefer highest-impression ad when cheap; label documented as one observed destination (UI tooltip), not authoritative. |
| TikTok `/campaign/get/` may exclude archived/deleted campaigns → spend-only rows silently dropped | Med | High | **[Red Team Fix #4]** Build TikTok rows from the UNION of spend-map keys and campaign list; fall back to raw campaign_id as name. |

## Backwards Compatibility

- New tool — no existing user flow changes.
- `fetchCampaigns` (FB) gains one **optional** trailing param (`includeAllStatuses = false`); existing callers (`app/api/campaigns/route.ts`, export-spend modal) are byte-for-byte unaffected.
- `fetchTodaySpend` (TikTok) kept as a thin wrapper over the new `fetchSpend`; the existing TikTok dashboard route is untouched.
- `account_owners` is a brand-new table (`create table if not exists`) → no migration of existing rows.
- `app/api/campaigns/route.ts` change is limited to adding `export` to `resolveDateParam` (no behavior change).
- Tool Hub gets one new card; no existing card altered.

## Test Matrix (no test framework in repo — manual + typecheck/lint, per repo convention)

| Layer | What to verify | How |
|-------|---------------|-----|
| SQL migration | `account_owners` created idempotently; RLS on, no policies | Run twice in Supabase SQL editor |
| `getVisibleUserIds` | staff→[self]; leader→[self,…team]; admin→all profile ids; **[Fix #5]** admin `listUsers` error throws, no `[self]` fallback | Manual call per role via dev session |
| FB `includeAllStatuses` | true → archived campaigns with historic spend appear; false → unchanged dashboard behavior | Compare counts for a known account across a past range |
| **[Fix #4]** TikTok archived campaigns | a campaign_id with Reporting spend but absent from `/campaign/get/` still appears in export (union) | Compare spend-map keys vs campaign list for a live advertiser |
| `campaign-destination.ts` | app-less campaign resolves to bare domain; malformed URL skipped; **[Fix #3]** highest-impression ad preferred | Manual call on a website-objective account |
| **[Fix #11]** No FX conversion | pick one known non-USD (e.g. VND) FB account; export spend+currency for a specific past date matches FB Ads Manager for that exact account/date | Manual compare before shipping |
| TikTok `fetchSpend` | since/until honored; `fetchTodaySpend` wrapper still today-only; **[Fix #10]** `'maximum'` maps to a concrete capped range | Compare a past range vs today |
| `campaign-target.ts` | app vs website classified; **[Fix #9]** `fields` param present so app_id/promotion_type/landing_page_url actually return; unknown fields logged not thrown | Inspect Vercel logs against a live advertiser |
| `GET /api/accounting-export` | 401 no auth; **[Fix #1]** staff → 403; admin/leader role-scoped rows; `warnings[]` on a bad account; **[Fix #12]** ≥5 consecutive failures → `leg_aborted`; both platforms | curl + dev session per role |
| **[Fix #2]** CSV injection | `owner_label` beginning `=`/`+`/`-`/`@`/tab is prefixed `'` in the exported CSV | Set a formula label, export, inspect file |
| **[Fix #5]** Coverage | admin response includes `coverage` (visibleUserCount vs totalOrgUserCount); UI renders it | curl + UI check |
| `GET/PATCH /api/account-owners` | list scoped; upsert persists + stamps `updated_by`; cross-team FB upsert rejected 403; **[Fix #7]** non-existent TikTok id rejected; TikTok upsert allowed for admin/leader | curl per role |
| UI | filters/sort/group work in-memory; per-currency subtotals; CSV opens in Excel with correct encoding; **[Fix #14]** inline owner edit updates loaded rows immediately + persists across reload; **[Fix #13]** date-timezone caveat visible | Manual smoke |

## Rollback

- **Per phase:** files are additive except `app/tools/page.tsx` (remove the new TOOLS entry) and the two signature additions (both optional/wrapped — revert the single param/wrapper).
- **DB:** **[Red Team Fix]** back up first — run `select * from account_owners;` and export the result — THEN `drop table if exists public.account_owners;` (prevents accidental owner-label loss during an unrelated incident rollback).
- **Route kill:** delete `app/api/accounting-export/route.ts` + `app/accounting-export/` to fully disable; no other tool depends on them.

## Success Criteria (measurable)

1. Tool card appears at `/tools`, links to `/accounting-export`.
2. Export returns rows for both platforms across a chosen past range, spend in native currency.
3. Archived/deleted FB campaigns with historic spend are included.
4. Each row shows a resolved target (app name / app_id / domain / "Unknown").
5. A single expired FB token surfaces as a warning, not a 500; other accounts still export.
6. **[Red Team Fix #14]** Owner label edited inline updates the already-loaded rows immediately, persists across reload, and appears in the export + CSV (no stale-value window).
7. Group-by-owner shows per-currency subtotals; no cross-currency sums.
8. CSV downloads, opens in Excel with correct UTF-8 (BOM) and matching columns; **[Fix #2]** formula-prefixed labels are neutralized.
9. **[Red Team Fix #1]** staff receive 403/redirect; only admin/leader reach the tool.
10. **[Red Team Fix #5]** admin sees a coverage note (e.g. "Showing spend for 12 of 12 users"); a `listUsers` error surfaces, never silently scopes to self.

## Red Team Review

### Session — 2026-07-28
**Findings:** 33 raw (4 reviewers: Security Adversary, Failure Mode Analyst, Assumption Destroyer, Scope & Complexity Critic) → 15 after dedup
**Severity breakdown:** 6 Critical, 7 High, 2 Medium
**Disposition:** All 15 accepted and applied (user confirmed "apply all 15")
**Effort impact:** estimate raised 15h → **18h (honest 18–20h range)** for parallelization rework, coverage signaling, rate limiting, row ceiling, and the added live-API verification steps.

| # | Finding | Severity | Applied To |
|---|---------|----------|------------|
| 1 | TikTok read leg had zero RBAC; whole tool gated to admin/leader (staff→403) | Critical | plan.md Access model, Phase 01, Phase 04, Phase 05 |
| 2 | CSV/formula injection via `owner_label` | Critical | Phase 06 (`export-csv.ts`) |
| 3 | "First ad wins" destination fabricates a campaign-wide attribute | Critical | Phase 02, Phase 06 (UI caveat) |
| 4 | TikTok leg drops spend-only archived/deleted campaigns | Critical | Phase 03, Phase 04 |
| 5 | No partial-visibility signal + silent `listUsers` error fallback to self | Critical | Phase 01, Phase 04, Phase 06 |
| 6 | Serial fan-out + sequential legs + unconfirmed Vercel tier | Critical | Phase 04 |
| 7 | TikTok owner PATCH: no existence check, no audit trail | High | Phase 01 (`updated_by`), Phase 05 |
| 8 | No rate limiting on expensive multi-API endpoint | High | Phase 04 |
| 9 | TikTok target-resolver omits the `fields` param (fields always missing) | High | Phase 03 |
| 10 | TikTok `'maximum'` preset has no concrete date range | High | Phase 03/04 |
| 11 | "Never FX-converted" assumption has no verification step | High | plan.md Test Matrix |
| 12 | Rate-limit cascade masked as many harmless per-account warnings | High | Phase 04, Phase 06 |
| 13 | Cross-platform / per-account date-boundary timezone mismatch | High | Phase 03 Risk, Phase 06 |
| 14 | Plan self-contradicts on owner-label edit freshness | Medium | Phase 06, plan.md Success Criteria |
| 15 | Client-side in-memory scale assumption unverified (row ceiling) | Medium | Phase 04, Phase 06 |

Two cheap cleanups bundled while editing: Rollback now backs up `account_owners` before drop; PATCH normalizes `owner_label` (trim + collapse whitespace) so "Sales" / "sales " don't fragment the group-by view.

## Unresolved Questions

1. **TikTok ad-group field names.** `app_id` / `promotion_type` (values?) / `landing_page_url` are best-guess, unverified against a live response (web research could not reach official docs). Phase 03 verifies early and adjusts — a normal implementation-time step, not a blocker. **[Red Team Fix #9]** now sends the `fields` param from the first attempt, so a "still missing" result diagnostically means the field *names* are wrong (the missing-fields confound is removed) — the verification is now genuinely informative.

_Resolved during red team:_ Vercel tier (was Q#1) is now a hard pre-implementation step at the top of Phase 04, not an open question (Fix #6). Owner-label authorization asymmetry (was Q#3) is resolved by the admin/leader gate + per-platform existence checks + `updated_by` audit stamp (Fix #1/#7).

## Validation Log

### Session — 2026-07-28
4 questions asked on implementation decisions the red-team fixes introduced (thresholds/tradeoffs, not open bugs):

| # | Question | Decision |
|---|----------|----------|
| 1 | Rate-limit cooldown (Fix #8) storage: in-memory vs DB-backed | **In-memory**, as planned — accepted as best-effort given the tool is now admin/leader-only (small trusted audience) |
| 2 | TikTok `'maximum'` preset lookback bound (Fix #10) | **1 year** (changed from the planner's 2-year default) — applied to Phase 04 §Architecture and §Implementation Steps |
| 3 | Group-by-owner subtotals + separate Manage Groupings panel (Scope critic's un-applied finding) | **Keep both, as planned** — explicit ask was for grouping to be "remembered and editable anytime," which implies in-app management, not CSV-only |
| 4 | 5,000-row export ceiling (Fix #15) | **Keep as-is** |

Only #2 required a plan edit (Phase 04: `today-2y` → `today-1y`, both in the Architecture note and `presetToRange` spec).
