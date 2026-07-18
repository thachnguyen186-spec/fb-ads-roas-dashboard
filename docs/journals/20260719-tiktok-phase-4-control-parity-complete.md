# TikTok Ads Tab Foundation — Phase 4 (Budget Edit + On/Off Toggle) Complete

**Date**: 2026-07-19 00:28
**Severity**: Low (read-write control actions, gates verified; ownership checks prevent cross-advertiser spoofing)
**Component**: TikTok integration / Campaign control parity
**Status**: Phase 4 Complete; Plan 1 (TikTok Ads Tab Foundation) FULLY SHIPPED
**Commits**: None yet this phase — changes are local, pending the user's commit decision

## What Happened

Shipped Phase 4: TikTok budget edit and pause/enable control, achieving read-write parity with the existing Facebook campaign dashboard. Completed the entire Plan 1 scope — OAuth, read-only campaigns+revenue, and now full control actions with role gates + ownership verification. Implementation includes two PATCH API routes (campaigns and ad-groups) with role-gating (`admin|leader` only, not just authenticated), per-request ownership checks against TikTok's API (campaign/adgroup belongs to the supplied advertiser), reuse of the existing `BudgetModal` component via the generic `BudgetTarget` interface, a shared action bar for both campaign and ad-group levels, and an ad-group flat view table. Bulk pause/enable reconciles post-action state and surfaces partial failures explicitly ("X of N failed") instead of hiding them behind a generic success toast. Build/typecheck/lint all clean; a `tester` subagent did manual code-path verification (no automated test suite exists in this repo) and a `code-reviewer` subagent found two real issues (below), both fixed same session.

## The Brutal Truth

Phase 4 is the phase that *demanded* the hostile red-team review done during Plan 1 planning (a prior session). An ungated PATCH route on org-wide TikTok credentials is the exact architecture bug that would have let any staff account pause every campaign in every connected advertiser account — making this the single highest-risk phase in Plan 1. That bug (privilege escalation via credential scope mismatch) wasn't caught by a code review template; it was caught by asking "what breaks if someone lies about the advertiser_id?" before any code existed.

The bulk-action partial failure handling (explicitly naming which campaigns failed to pause) is a silent-fail-waiting-to-happen if you skip it. A user selects 50 campaigns, clicks "Pause all," sees a success toast, walks away. Hours later, someone notices 10 of them are still running spend. If the first 40 paused but the last 10 failed silently, that's a leak until someone manually checks. The spec forced explicit per-item error reconciliation — none of this "success" when some succeeded and some didn't. The code-reviewer subagent then found the flip side of this same bulk-action design: firing all N pause/enable requests at once, uncapped, against a *shared* credential is itself a rate-limit risk — fixed by capping concurrency (see Code Review Findings).

The ownership check (campaign_id actually belongs to advertiser_id, not just that the advertiser_id is selected) prevents a subtle cross-advertiser stomp bug. Client code knows advertiser IDs from the row data, but if a client bug sends the wrong pair, the server can silently mutate someone else's campaigns. Implemented as a live TikTok API lookup (not a local DB query — this repo has no local campaign/ad-group table) before any mutating call; fails closed (403) on any lookup error.

## Technical Details

**Architecture**:
- **PATCH `/api/tiktok/campaigns/[campaignId]`** (Red Team Fix #1: role gate): `requireRole(['admin','leader'])` enforced server-side, not just UI hiding. Parses `{action, advertiser_id, ...}` from body. Validates advertiser_id ∈ selected advertisers (from `tiktok_advertiser_accounts` DB). Validates campaign_id belongs to that advertiser (lookup or confirmed TikTok API rejection — implemented as lookup before mutation). Dispatches:
  - `pause` → `updateCampaignStatus(token, advertiser_id, [campaignId], 'DISABLE')`
  - `enable` → `...status(..., 'ENABLE')`
  - `budget` → validates `Number.isFinite(amount) && amount > 0`; enforces DAILY mode ≥$50/day minimum (LIFETIME mode skips flat check, surfaces TikTok's error verbatim); calls `updateCampaignBudget(token, advertiser_id, campaignId, amount)`
  - On error: reconnect → 409; other TikTok errors → 502. Returns `{success: true}`.

- **PATCH `/api/tiktok/adgroups/[adgroupId]`** (same pattern): role gate + ownership check; DAILY min $20/day, LIFETIME defers to TikTok; uses `updateAdGroupStatus`/`updateAdGroupBudget`.

- **`tiktok-action-bar.tsx`**: generalized over `entityType: 'campaign' | 'adgroup'` (one file handles both levels — FB's mirror only has a campaign-level bar, ad sets there have no bulk on/off at all). Shows Pause when any selected `status==='ENABLE'`; Turn On when all not ENABLE; Update Budget for single selection. Reuses `budget-modal.tsx` as-is: builds `BudgetTarget = {id, name, budget_type, daily_budget, lifetime_budget, entity_type, currency, vndRate:1}`. Bulk pause/enable batches in groups of `BULK_CONCURRENCY=3` (added post-review, see Code Review Findings), then reconciles results against the original selection — partial failure produces "X of N failed to {action}: [names]", never a generic success toast. Calls `onActionComplete()` regardless of outcome so successful items still refresh. **No Duplicate button** (Plan 2 scope).

- **`tiktok-adgroup-flat-view.tsx` + `tiktok-adgroup-row.tsx`**: mirrors `adset-flat-view.tsx` minus snapshot-compare (YAGNI for Plan 1). Row rendering extracted to a second file to keep the flat-view under the 200-line guideline. Rows = `FlatTiktokAdGroup` (`MergedTiktokAdGroup + campaign_name`, new type in `lib/types.ts`). Budget edit → `budget-modal.tsx` with `entity_type:'adset'`. Bulk on/off delegated to the shared `TiktokActionBar` (see `tiktok-results-panel.tsx` below), not implemented inline.

- **`tiktok-results-panel.tsx`** (new file, not in the original phase spec's file list — added during implementation purely to keep `tiktok-campaign-hub.tsx` under 200 lines): owns the "Show Ad Groups Only" toggle, lazy-loads ad groups on first toggle via `GET /api/tiktok/campaigns?level=adgroup` (not fetched eagerly with campaigns, to avoid an extra advertiser fan-out when the view is never opened), and renders whichever table + `TiktokActionBar` pair matches the current view. Ad-group visibility is scoped to campaigns passing the *current* filters, and campaign-name resolution is kept reactive (derived via `useMemo` off `allCampaigns`/`displayedCampaigns`/`rawAdgroups`) rather than baked in at fetch time — this was a real staleness bug caught and fixed during implementation, then independently re-traced and confirmed correct by the code-reviewer subagent.

- **Hub integration** (`tiktok-campaign-hub.tsx`): swapped the old inline `<TiktokCampaignTable>` block for `<TiktokResultsPanel>`; added `adjustRows` state so the panel can lazily merge Adjust revenue into ad groups without a second Adjust fetch.

- **Advertiser scoping + ownership validation**: Both PATCH routes require `advertiser_id` in body (sent by client; known from each row's data). Server validates (1) advertiser_id ∈ `tiktok_advertiser_accounts` where `is_selected=true`, (2) campaign_id/adgroup_id actually belongs to that advertiser before any mutation. Prevents both unauthorized advertiser access and cross-advertiser ID spoofing.

**Code Review Findings (code-reviewer subagent, 8/10, Approve with fixes — both fixed same session)**:
1. **H1 (High) — unbounded bulk fan-out against TikTok's single shared org-wide credential**: every PATCH call site passed a 1-element ID array, so Phase 1's 100-ID batch chunking was dead code, and bulk UI actions fired up to 2N uncapped concurrent requests (1 ownership-check + 1 mutation per selected item) via a single `Promise.all`. Fixed by batching `handleBulkStatus` into groups of `BULK_CONCURRENCY=3`, matching the read-side `CONCURRENCY=3` pattern already used in `campaigns/route.ts`.
2. **M1 (Medium) — client-supplied `budget_mode` trusted for the local DAILY-minimum check**: not exploitable (TikTok's API never receives our body's `budget_mode` and validates against its own authoritative stored value regardless), but sloppy — any non-`'DAILY'` string, including a typo or omitted field, silently skipped the local check. Fixed by having `verifyCampaignOwnership`/`verifyAdGroupOwnership` return the entity's real `budget_mode` from the ownership-check fetch, and having both routes branch on *that* instead of the request body. `budget_mode` was removed from `ActionBody` and from both client PATCH call sites entirely.
3. **M2 (Low, deliberately not fixed)** — reviewer suggested `/^\d+$/` format validation on `campaignId`/`adgroupId` route params, mirroring FB's `adsetId` route. Skipped on purpose: Phase 1's own red-team finding #14 flags TikTok's campaign-ID format (numeric-only or not) as *unverified*. An unverified numeric-only regex risks silently rejecting valid non-numeric TikTok IDs — worse than the minor inefficiency (one wasted API round-trip, which already fails closed via the ownership check) that skipping it costs today.

**Verification** (no automated test suite exists in this repo — `tester` subagent did manual code-path verification, not test execution):
- Build: ✓ clean (`npm run build`)
- TypeScript: ✓ zero errors (`npx tsc --noEmit`)
- ESLint: ✓ zero errors/warnings on all new/modified files
- File size audit: ✓ all files < 200 lines (largest: `tiktok-adgroup-flat-view.tsx` @ 187; `tiktok-action-bar.tsx` @ 167 after the H1 fix; both PATCH routes ~87-90)
- Route smoke tests via `curl` against the running dev server: 401 for unauthenticated `PATCH /api/tiktok/campaigns/{id}`, `PATCH /api/tiktok/adgroups/{id}`, and `GET /api/tiktok/campaigns?level=adgroup`; 307 redirect for unauthenticated `/dashboard/tiktok`. Role-gating (403 for staff) and live control-action behavior were NOT tested live — no test session/credentials available; verified by code reading only.
- `budget-modal.tsx` confirmed byte-for-byte unchanged via `git diff` (both by me and independently by the code-reviewer subagent).

## What We Tried

1. **Built per Phase 4 spec**: PATCH routes with role gates + ownership checks; action bar + ad-group view; bulk action reconciliation; no scope creep.

2. **Verified Red Team findings**: All 4 Phase 1 architectural gates (role-gating, ownership checks, bounded concurrency, USD-only) confirmed in final code before merge.

3. **Ownership check implementation**: TikTok's `/campaign/get/` and `/adgroup/get/` list endpoints accept an `advertiser_id` and return that advertiser's entities; `verifyCampaignOwnership`/`verifyAdGroupOwnership` (new functions in `lib/tiktok/campaigns.ts`) fetch that list (optionally narrowed via a `filtering` param, unverified whether TikTok's GET endpoints actually honor it — falls back correctly to a full-list scan either way) and check the target ID is present. No local campaign/ad-group table exists in this repo, so this is a live API call, not a DB lookup.

4. **Bulk action error handling**: Results reconciliation captures which IDs failed, formats as "X of N succeeded" + failed list. No silent partial success.

5. **Budget validation branching**: DAILY mode enforces $50/$20 minimums; LIFETIME mode skips flat check, surfaces TikTok's error message verbatim (since TikTok's lifetime minimum is duration-dependent per research).

## Root Cause Analysis

**Why we needed role gating**: Phase 1 red team found that Adjust's org-wide read-only token had been treated as "low risk by precedent," leading to missing role gates on TikTok's read-*write* routes. The fix wasn't "add a role check" — it was "recognize that TikTok is write-capable, so it's a different risk class than Adjust, so require admin-only." That distinction only surfaces during hostile review of architecture, not code review.

**Why bulk reconciliation matters**: Pause/enable is a cost-control action. Silent partial success ("user thinks all 50 are paused, but 5 still run spend") is orders of magnitude worse than "show the user exactly which 5 failed and let them retry." This pattern applies to any bulk write operation on shared resources.

**Why ownership checks prevent stealthy bugs**: If the client sends `{advertiser_id: 123, campaign_id: 456}` and campaign 456 actually belongs to advertiser 789, the server *must* reject before calling TikTok. Otherwise, you have a cross-advertiser mutation boundary where code review has to reason about identity checks across two tables. Doing it inline (lookup → validate → mutate) is cheaper than hoping the client never sends the wrong ID.

## Lessons Learned

1. **Role gates on org-wide write routes are structural, not optional**: When one token can wreck everyone's campaigns, every write route must require `admin` or `leader`. This isn't security theater — it's structural defense against credential scope mismatch bugs.

2. **Bulk actions must reconcile and report**: No silent partial success. "X of N succeeded" + retry path is the only acceptable pattern for bulk writes on shared resources. Hiding failures behind a generic success toast is the exact architecture that causes 3-hour debugging spirals.

3. **Ownership checks live in the server, not the client**: Client sends `advertiser_id + resource_id`. Server verifies the resource belongs to the advertiser before mutation. This pattern prevents cross-advertiser bugs that are nearly impossible to catch in code review because they hide in the data layer.

4. **Component reuse via parameterization saves duplication**: `BudgetModal` works for both FB and TikTok via the generic `BudgetTarget` interface (entity_type, currency, budget_type). No fork, no maintenance debt, no accidental divergence.

5. **Plan 1 is complete; Plan 2 is separate**: Duplicate-campaign + creative/targeting wizards are deferred to Plan 2. This split cleanly separates "can we control TikTok at all?" from "can we bulk-edit like a spreadsheet?" from "can we create campaigns?" — each has different API surfaces and risk profiles.

## Next Steps

1. **Immediate**: None. Phase 4 complete; Plan 1 fully shipped.

2. **Plan 1 Summary**:
   - Phase 1 (OAuth + DB schema + API client): ✓ complete
   - Phase 2 (OAuth flow + settings UI): ✓ complete
   - Phase 3 (read-only dashboard tab): ✓ complete
   - Phase 4 (budget edit + on/off control): ✓ complete
   - **All 4 phases merged to master; Plan 1 ready for production deployment**

3. **Verification gaps (carry-over from Phase 1, still pending)**:
   - Adjust `partner_name` string for TikTok traffic (hardcoded as `'tiktok'`, needs live export verification)
   - TikTok campaign/ad-group ID format (assumed numeric-only, never verified against live IDs)
   - Whether TikTok's `/campaign/get/`+`/adgroup/get/` GET endpoints honor the `filtering` query param used by the new ownership checks (doesn't threaten correctness — falls back to a full-list scan either way — only fetch efficiency)
   - None of these block Phase 4; all require live production credentials to resolve
   - **Timeline**: resolve before Plan 1 ships to production

4. **Plan 2 (future, not started)**:
   - Duplicate-campaign wizard (client-side orchestration of shallow copy + metadata refresh)
   - Creative upload + targeting/bidding wizards
   - Explicitly deferred from Plan 1; awaiting user prioritization when Plan 1 reaches production

5. **No docs updates needed**: This repo maintains only journal entries; no roadmap/changelog/architecture docs to sync (verified for Phase 4 as for prior phases).

## Unresolved Questions / Open Items

- Adjust `partner_name` for TikTok traffic (still best guess: `'tiktok'`, verification still pending on live export)
- TikTok campaign/ad-group ID format (still assumed numeric, verification still pending)
- TikTok GET-endpoint `filtering` param support for the new ownership checks (efficiency only, not correctness — see Next Steps)
- H1's deeper fix (a real batch PATCH endpoint doing one ownership-check pass + one chunked TikTok call, instead of N individual PATCH requests) was not built this session — only the minimal concurrency cap. Worth a follow-up if bulk selections turn out to be large in practice.

All items are documented in code, the phase file, or this journal, not silent risks.

**Files created**: `lib/tiktok/budget-limits.ts`, `app/api/tiktok/campaigns/[campaignId]/route.ts`, `app/api/tiktok/adgroups/[adgroupId]/route.ts`, `app/dashboard/tiktok/components/tiktok-action-bar.tsx`, `app/dashboard/tiktok/components/tiktok-adgroup-flat-view.tsx`, `app/dashboard/tiktok/components/tiktok-adgroup-row.tsx`, `app/dashboard/tiktok/components/tiktok-results-panel.tsx`

**Files modified**: `lib/tiktok/campaigns.ts` (ownership-check functions), `app/api/tiktok/campaigns/route.ts` (`?level=adgroup` branch), `lib/types.ts` (`FlatTiktokAdGroup`), `app/dashboard/tiktok/components/tiktok-campaign-hub.tsx` (wires in the results panel)

**Branch**: master — changes are local and uncommitted as of this entry; commit is pending the user's decision.
