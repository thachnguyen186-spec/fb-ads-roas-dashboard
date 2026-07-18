# TikTok Ads Tab Foundation: Planning Session Complete

**Date**: 2026-07-18 14:30
**Severity**: Medium (planning-stage findings, no production risk yet)
**Component**: Product roadmap / TikTok integration planning
**Status**: Plan complete; awaiting user OAuth prerequisites and Phase 2 creation

## What Happened

User requested a plan to add TikTok Ads as a second platform tab alongside the existing Facebook Ads dashboard. Revenue stays sourced from Adjust (same as Facebook); spend comes from TikTok's Business/Marketing API v1.3. Scope was immediately large, so we ran a challenge-and-split: scope ~30 work items (OAuth + campaign/ad-group read/control + creative wizards) were split into Plan 1 (TikTok tab foundation: OAuth, campaign/ad-group parity, Adjust revenue wiring) and Plan 2 (future: duplicate-campaign + creative/targeting/bidding wizards, not yet created).

Two parallel researcher subagents investigated TikTok's API surface: one covered OAuth + campaign/ad-group endpoints + spend reporting; the other covered campaign/ad-group/ad creation + creative upload (needed for Plan 2). Planner subagent synthesized findings into 4-phase implementation plan with 5 detailed phase files. Then we ran a hostile red team review to gut-check architectural decisions — 3 adversary subagents (Security Adversary, Assumption Destroyer, Failure Mode Analyst) found 23 raw issues, deduplicated to 15 (3 Critical, 8 High, 4 Medium). User approved applying all 15. Finally, a validation interview resolved 4 open questions left by the red team fixes.

## The Brutal Truth

This planning session nearly shipped with **5 architectural holes** serious enough to have caused production incidents after code went live. We caught them only because we red-teamed before writing code. Most painful:

1. **Org-wide credential with per-route role check**: Phase 4's budget/on-off control routes would have let any staff account rewrite the shared TikTok connection (pause/re-budget all campaigns org-wide). Facebook has per-user token scoping, so users can only wreck their own stuff. TikTok's org-wide token means anyone who can call those routes wrecks everyone's campaigns. This is exactly the architecture that causes "marketing spent 3 hours wondering why all campaigns went offline" on a Monday morning.

2. **Silent FX conversion bugs**: ROAS/Profit math would have divided TikTok spend (native currency: THB, CNY, etc. depending on advertiser account location) against Adjust revenue (always USD). This is the exact bug Facebook already had to solve mid-project (commit cfa6874: Bangkok timezone fix was pair #2 to an earlier VND conversion issue). We were about to reintroduce it for TikTok.

3. **Day-boundary timezone trap (redux)**: The plan initially had no mention of timezone handling for "today's revenue" computation. Given that the immediately preceding session just fixed this for Facebook's Adjust integration, it felt criminally negligent to leave it undefined for TikTok. Flagged explicitly.

4. **Reporting lag UX decision deferred**: TikTok reporting lags 24-48h behind Facebook's. The plan didn't specify how to show this in the UI. Users might re-fetch today's revenue expecting new data and find nothing for 2 days, thinking the feature broke.

5. **Reauth silently rebinds everyone**: OAuth reconnect (admin + leader gate) would have silently swapped the entire org's TikTok connection to a new advertiser account without warning. If an admin fat-fingered the oauth flow, everyone's campaigns would suddenly orphan.

We didn't just identify these; we applied all 15 fixes inline into the plan with 🔴 markers and updated plan.md with a red team summary table.

## Technical Details

**Red Team Review Summary** (15 findings):
- **3 Critical**: (1) Role gate on org-wide control routes missing → added admin-only gate matching existing RBAC. (2) OAuth reconnect silently rebinds → tightened to admin-only, added confirmation warning in Phase 2 UI mockup. (3) Timezone handling undefined for Adjust revenue wiring → hardcoded `+07:00` offset per Bangkok locale (documented rationale: Thailand uses fixed UTC+7, no DST since 1920).
- **8 High**: Missing FX conversion spec → marked USD-only for Plan 1, non-USD advertiser accounts blocked; partial bulk-action failure handling undefined → explicit "X of N failed" + manual retry; token refresh timing strategy unclear → lazy on-demand instead of cron (access tokens expire 24h); Adjust integration contract undefined → re-used existing `tiktok_connection` singleton table design pattern (mirrors how Adjust token is org-wide, not per-user like Facebook); missing DB cascade deletes → added explicit on-delete behavior for advertiser_accounts ↔ campaigns; OAuth scope ID list missing → documented as unresolved dependency; error telemetry for API failures undefined → deferred to Phase 3; production vs. sandbox account handling undefined → noted in Phase 2.
- **4 Medium**: Budget validation gaps → re-used existing `BudgetModal` component constraints; Settings UI UX for single-connection management → documented as Phase 2 scope; API rate-limit strategy undefined → defer to Phase 3 when live; error message clarity for TikTok-specific rejection codes → Phase 3.

**Plan Structure** (`plans/260718-1343-tiktok-ads-tab-foundation/`):
- **plan.md**: Overview (6 pages), 4 phases + red team summary table + validation log
- **phase-01-tiktok-api-client-db-schema.md**: TikTok API client wrapper (lazy token refresh, error handling), DB schema (`tiktok_connection` singleton, `tiktok_advertiser_accounts` with Adjust mapping, `tiktok_campaigns` + `tiktok_ads` for read/control parity)
- **phase-02-oauth-connect-flow.md**: OAuth authorization (Admin-only, confirmation warning on reconnect), Settings UI for connection status + disconnect
- **phase-03-dashboard-tab-layout.md**: Separate Next.js route `/dashboard/tiktok` (prevents FB data loading simultaneously per user's explicit requirement), tab-switcher UI, campaign/ad-group list with read-only metrics
- **phase-04-budget-edit-control.md**: Reuse existing `BudgetModal` component, campaign on/off toggle, spend validation against Adjust-sourced budget ceiling

**Validation Interview Questions Resolved**:
1. **Currency scope**: USD-only for Plan 1. Non-USD advertiser accounts will be blocked from connection during OAuth consent (simplest UX, avoids partial FX conversion bugs).
2. **OAuth scope**: Admin-only gate confirmed for both initial connect and reconnect (per existing RBAC conventions in codebase).
3. **Reporting lag**: Today's column remains primary view; inline lag warning added ("TikTok reports with 24-48h delay").
4. **Partial bulk failures**: "X of N campaigns paused" + manual retry button. No silent partial success, no auto-retry.

**Not Done / Explicitly Deferred**:
- **Task hydration**: VSCode extension environment has Task tools unavailable (TaskCreate/TaskList). Plan files remain source of truth. Script `node .claude/scripts/set-active-plan.cjs` doesn't exist in this repo (pre-existing gap in `.claude/scripts/` setup), so active-plan tracking wasn't recorded.
- **Plan 2 (duplicate-campaign wizard)**: Not created. Explicitly documented as forward pointer in Plan 1's Next Steps section.
- **OAuth prerequisites**: User must whitelist production OAuth callback URL in TikTok Developer Portal (currently points to placeholder `giftago.co` domain per screenshot). User must also confirm exact OAuth scope IDs to request (undocumented in TikTok's public API docs). Both block any live E2E testing.

## What We Tried

1. **Scope challenge** (planning kickoff): Proposed splitting into two plans rather than merging everything into one giant (and unmergeable) PR. User approved. ✓

2. **Parallel research** (2 subagents): Investigated API v1.3 auth + control endpoints; investigated campaign/creative endpoints for Plan 2. Reports saved to plans/reports/. ✓

3. **Plan drafting** (planner subagent): Synthesized research into 4-phase architecture. ✓

4. **Red team review** (3 adversary subagents): Ran hostile review looking for architectural flaws, security gaps, assumption violations. Found 23 issues. ✓

5. **Triage + fix**: Deduplicated findings to 15 unique issues. Applied all 15 fixes inline with 🔴 markers. User reviewed + approved each. ✓

6. **Validation interview**: 4 follow-up Q&A to resolve ambiguities left by red team fixes. Documented in plan.md Validation Log. ✓

## Root Cause Analysis

The planning discipline worked. Skipping the red team step would have meant shipping code with an org-wide credential but only route-level role checks (6-month production bug waiting to happen). The day-boundary timezone issue would have manifested exactly like the Facebook bug: "today's revenue is half the actual value" reported by users, debugged via painful A/B testing against APIs, fixed in a hotfix commit. The FX conversion trap was undetected because no one had built TikTok revenue math yet, so "spend / revenue" was aspirational code that never ran.

Why we caught it: **Hostile red team on the plan before code is infinitely cheaper than hotfixes after deployment.**

## Lessons Learned

1. **Red team plans, not just code**: This session is living proof that architectural review at plan time catches issues code review misses. Three adversaries finding 23 issues in a text plan beats three reviewers finding 3 issues in a merged PR.

2. **Timezone is a permanent part of any finance feature**: The Bangkok timezone issue just fixed in Adjust code is a template. Any feature touching revenue, spend, or "today's" computations must specify timezone explicitly and link to team location context. Document why it's hardcoded (e.g., "Thailand UTC+7, no DST since 1920").

3. **Org-wide credentials demand admin-only gates**: When a single credential can wreck everyone (TikTok token vs. Facebook per-user tokens), every route that uses it must require admin+ role. This is not a "nice to have" — it's structural.

4. **Reporting lag is a UX problem, not a bug**: TikTok's 24-48h lag is real. Document it upfront in the UI (inline warning), don't hide it and let users file "why is data stale?" tickets.

5. **Split plans by API contract, not by calendar**: Plan 1 (OAuth + read/control parity) and Plan 2 (wizards) cleanly separate "integrate TikTok the platform" from "add spreadsheet-like UX". This is better than splitting by sprint or person count.

## Next Steps

1. **Immediate**: None. Plan is complete and approved.

2. **Blocking (user's action)**:
   - Whitelist production OAuth callback URL in TikTok Developer Portal (currently pointing to giftago.co placeholder per your screenshot)
   - Confirm exact OAuth scope IDs to request (currently documented as TBD in phase-02)
   - **Owner**: User (TikTok Developer Portal access)
   - **Timeline**: Required before any Phase 2 implementation can start

3. **Follow-up (code implementation)**:
   - Implement Phase 1 (API client + DB schema) — assign to dev once OAuth prerequisites cleared
   - Phase 2 (OAuth UI) — depends on Phase 1 complete
   - Phase 3 (dashboard tab) — depends on Phase 1 + 2
   - Phase 4 (budget/control) — depends on Phase 1 + 3
   - **Estimated effort**: Phases 1-4 roughly 5–6 dev-days each (rough, pending detailed sprint planning)

4. **Out of scope (Plan 2, future)**:
   - Duplicate-campaign wizard (copy FB campaigns to TikTok)
   - Creative upload + targeting/bidding wizards
   - Not yet created; requires user to prioritize when Plan 1 reaches Staging

**Plan Location**: `plans/260718-1343-tiktok-ads-tab-foundation/`
**Research Reports**: `plans/reports/researcher-260718-0920-tiktok-api-auth-control.md`, `plans/reports/researcher-260718-0926-tiktok-api-campaign-creative.md`

