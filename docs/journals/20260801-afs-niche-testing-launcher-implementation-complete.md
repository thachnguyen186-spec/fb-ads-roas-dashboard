# AFS Niche Testing Launcher — Implementation Complete

**Date**: 2026-08-01
**Component**: Dashboard tool / Facebook Marketing API integration / AI content generation
**Status**: Code-complete; NOT production-ready (3 manual gates remaining)
**Effort**: 6 phases, ~32h estimated, delivered in one parallel-subagent session

## What Happened

Implemented the full AFS Niche Testing Launcher feature planned on 2026-07-31. The tool lets admins/leaders paste 1-20 topics {description, target URL}, auto-generates 5 image ads per topic (OpenAI fills a fixed ruleset template, Kie AI renders via GPT-Image-1), generates ad copy and country suggestions, lives everything as DB drafts, then bulk-publish real Facebook campaigns (1 campaign + 1 adset + 5 ads per topic). Execution: phases delegated to parallel `fullstack-developer` subagents (Phase 01 solo → Phases 02∥04 parallel → Phase 03 → 05 → 06 sequential), with orchestrating session spot-verifying safety-critical logic (crypto round-trip, budget pass-through, idempotency guards) and personally fixing bugs found during review.

## The Brutal Truth

A code-review pass AFTER full implementation found 8 real issues, **2 of them Critical money-loss race conditions**. This is the harsh reminder that full-systems testing (even with a narrower tester pass earlier) can miss what an adversarial review catches — and for a feature that spends real Facebook budget, "catching it in code review" beats "discovering it in production" by exactly the margin of the duplicated ad spend before anyone noticed. The parallel subagent execution and spot-checks prevented several plan-stage bugs from shipping, but code-review turned up gaps that ate ~3 extra hours to fix and verify. This is a workflow observation: full implementation → narrow verification → THEN adversarial review is risky for money-spending features; the order matters.

## Technical Details

**The Critical Fixes:**

1. **Publish state machine race condition** — The step-based publish loop (step 1: create campaign, step 2: create adset, step 3: publish creatives) had no atomic per-step claim. Two concurrent calls (a user retrying a network error, a duplicated button tap, a second browser tab) could both start from the same step and create duplicate FB campaign/adset/ad objects before either recorded its work. **Fix:** Added an atomic `claiming:<uuid>` UPDATE placeholder pattern — before any FB call, execute a conditional UPDATE to claim the step with a sentinel UUID; on FB success, overwrite the placeholder with the real FB object ID; on failure, clear it back to null so a retry can reclaim. Verified with race-condition simulation (concurrent requests to the same publish route).

2. **Special-ad-category enforcement was UI-only** — The risk-keyword check (employment/housing/credit keywords require `special_ad_categories=EMPLOYMENT` or similar, with account-wide Meta blast radius if miscategorized) lived only in the React component's review screen, bypassable via a direct POST to `/topics/{id}/publish`. **Fix:** Extracted the keyword list to `lib/afs/risk-keywords.ts`, re-enforced it server-side in the publish route with a hard blocker (no dismissible override at this gate), matching the UI's own gate. Same override-phrase mechanism on both sides.

**The High-Severity Gaps:**

3. **Budget ceiling unenforced at batch intake** — `AFS_MAX_DAILY_BUDGET_MINOR` was only checked in the PATCH route that edits a single topic's budget; batch intake (POST `/batches`) and the final pre-publish guard were missing. **Fix:** Added ceiling validation at both intake time and immediately before the FB publish call.

4. **Currency conversion trusted client input** — The PATCH route accepted a client-supplied `currency` string and used it to convert major→minor units, risking a ~100× silent mis-conversion for VND accounts (or any pair of 2 vs 3 minor-unit currencies). **Fix:** Moved authoritative conversion to the PATCH route only; derive currency server-side from the ad account's own properties, never trust the client.

5. **Connection fields stayed editable after publish** — `ad_account_id`, `page_id`, `pixel_id` could be edited via PATCH even after a topic had an `fb_campaign_id` (meaning the adset was already bound to the original account/page), risking account/page mismatch on a partial-failure retry. **Fix:** Lock these three fields if `fb_campaign_id` is non-null; return 409 on any attempt to edit a `publishing` or `published` topic's connections.

**The Medium & Low Fixes:**

6. **Pending creatives invisible to reconcile** — Kie jobs stuck at `pending` status (e.g., a failed generate() between the DB insert and Kie submission) were never reconciled and never timed out. **Fix:** Added parallel reconcile path in `reconcile.ts` that queries for pending rows and moves them to a timeout state after 15 minutes.

7. **SSRF hardening gap in image rehost** — The Kie image rehost step fetched vendor-supplied URLs with no scheme/host validation. **Fix:** Added explicit `https://` scheme enforcement and private-IP-range rejection guard; validate content-type and size before download.

8. **String.replace() misuse** — One LLM-generated prompt-value was used as a replacement *pattern* in `String.replace()` instead of a literal, risking silent corruption if the output contained `$&` or `$1`. **Fix:** Replaced with a replacer function; all regex patterns are code constants, not dynamic.

9. **(Bonus) Pixel-list endpoint auth gap** — The endpoint accepted any `accountId` without validating it belonged to the caller's own saved ad accounts. **Fix:** Server-side check that the requested account is in the caller's own accounts list.

All fixes were verified via `npx tsc --noEmit` + `npm run lint` + `npm run build` — all clean, no new issues beyond ~5 pre-existing unrelated warnings.

## What We Tried

- **Parallel subagent execution** respecting the plan's dependency graph: worked cleanly; no file conflicts or merge issues.
- **Spot-verification during phase integration:** caught 2-3 issues early (crypto round-trip, token isolation), preventing them from snowballing into review findings.
- **Narrow tester pass before code review:** confirmed 0 defects across 63 checks, but missed the race condition and enforcement gaps — a narrower verification pass is not a substitute for an adversarial review.
- **Comprehensive code-review pass post-implementation:** caught all 8 issues; fixes applied within the same session and re-verified by tester (0 regressions).

## Root Cause Analysis

Why did a Critical race condition reach code review instead of being caught in design or testing?

1. The step-based publish design (decision made mid-planning to eliminate Vercel-tier gating) was correct, but the atomicity contract — "one call per step, no concurrent claims" — was stated in English in the phase doc, never enforced in code. The lack of an explicit UPDATE pattern left it implicit.

2. The special-ad-category keyword enforcement was relegated to the UI because the original design had no API boundary for it — the thought was "if the client catches it, the server never sees it." But any API is public; someone will `curl` it. The assumption that UI validation is sufficient for a money-spending flow is the real bug.

3. The budget ceiling was checked in one place because the PATCH route was identified as the "authoritative" conversion point, but "authoritative" was never extended to mean "also enforce the ceiling here" — it meant "do the unit conversion here." Similar assumption failure.

4. The currency handling evolved: the original plan had each route derive its own currency, but then Phase 05 PATCH introduced a client-supplied override for UX reasons ("user can pick the currency for display"), and the assumption drifted to "if the client supplies it, it's been validated already." It wasn't.

5. The connection-field editability gap: the design said "these fields are required at intake, reviewed in the edit step" but never said "lock them after the adset exists." The assumption was "the UI has its own review/confirmation flow, that's defense enough." It wasn't.

6. The pending-creative timeout and SSRF gaps: these are classic "the happy path works, we didn't model the failure path deeply enough."

**Pattern:** Planning-stage analysis caught the *structural* risks (money burnt by unreviewed campaigns, races during multi-step publish), but missed the *enforcement gaps* (where is the rule actually checked? at every entry point?). The red-team review focused on architecture and explicit risks; an implementation-phase security/robustness review would have caught these earlier. A narrower tester pass (functional coverage) doesn't cover "adversarial API usage" at all.

## Lessons Learned

1. **For money-spending features, require adversarial code review after full implementation, not before.** Narrow verification (happy-path tests, unit checks) can miss enforcement gaps that only show up when you try to break the API. The cost of an extra review pass is trivial compared to duplicated ad spend.

2. **Every API boundary needs its own enforcement, not inherited from UI.**  If a route can be called via API (not just the browser), assume it will be. Don't assume the UI's validation is enough. The phrase to internalize: "trust no client input, not even from your own UI."

3. **"Authoritative" means both "derives the truth" and "enforces all constraints at that boundary."** When you identify the PATCH route as the "authoritative" conversion point, that's not just about which route does the math — it's about which route is responsible for rejecting invalid inputs. Make it explicit in code and comments.

4. **Atomic operations need explicit guard patterns, not English contracts.** The step-based publish is elegant in the plan; the claiming-sentinel pattern is elegant in code. The gap between them was a 1-hour fix that prevents a real money-loss bug. Write the pattern first, frame the design around it, not vice versa.

5. **Parallel subagent execution works well for no-overlap phases, but spot-verification by the orchestrating session is essential for safety-critical logic.** This feature succeeded because the orchestrating session personally verified the crypto round-trip and budget pass-through. Don't delegate security-critical verification; spot-check it yourself.

6. **Pending-state timeout logic is not optional for async job orchestration.** If a job can get stuck in an intermediate state, the reconcile loop must recognize it and move it to a terminal state. This is not a "nice to have" for observability; it's a blocker for operational correctness.

## Next Steps

**Immediately (blocking production deployment):**

1. **Run the manual Ads Manager canary** (Pre-Implementation Gate) — log into FB Ads Manager with the external leader's account (not the developer's), confirm the assumed ODAX enum combo (`objective=OUTCOME_TRAFFIC`, `optimization_goal=LINK_CLICKS`, `billing_event=IMPRESSIONS`, `destination_type=WEBSITE`) and the `special_ad_categories` field shape. Takes ~15 min. Outcome: proceed to gate 2, or discover that the enums are wrong (requires code change).

2. **Verify the Kie GPT-Image-1 model ID and input field names** (Phase 04) — ping Kie support or check their live account dashboard: confirm `KIE_MODEL=gpt-image/1.5-text-to-image` is correct, and whether the marketplace `jobs/createTask` path is the right endpoint or if it requires the legacy `POST /api/v1/gpt4o-image/generate` path. Confirm input field names (`quality`, `resolution`, `aspect_ratio`) and output pixel dimensions. Takes ~1h (including waiting for async Kie response if needed). Outcome: update `.env.local.example` + `kie-client.ts`, or switch to the fallback endpoint (risk: payload shape completely different, +2h refactor).

3. **Run the Launch Gate canary** — publish ONE health-adjacent topic (e.g., nutrition tips, fitness advice) to the genuine external leader's account and wait for Meta's review verdict to complete (usually 24-48h). This confirms: (a) the external leader has Advanced Access for `ads_management` on their ad account (if not, they need to request it from Meta now), (b) Meta's content policy accepts the generated images + copy, (c) the full step-based publish loop works end-to-end against real FB objects. Outcome: proceed to multi-topic batches, or discover a policy rejection (requires prompt template refinement + re-test).

**After gates are cleared:**

- Deploy to production and monitor the first 5-10 topic batches for any edge cases.
- Document the three gates in an internal runbook (when on-boarding a new admin/leader to this tool, they'll need to know why their first topic publish blocks on a canary).

**Future hardening (non-blocking, post-MVP):**

- Add a 404-check guard on image rehost (if Kie's URL ever returns a 404, the current code blindly re-hosts a 404 page; a HEAD request first would catch this).
- Implement per-row distributed tracing for the step-based publish flow (aid in debugging partial failures for ops).
- Add metrics: topics generated, topics published, FB API errors by type, rate-limit hits (is the shared 300/hr quota actually a constraint?).

**File paths for reference:**
- Implementation code: `lib/afs/*`, `lib/facebook/*`, `lib/ai/*`, `lib/kie/*`, `app/api/afs-niche-testing/*`, `app/afs-niche-testing/*`, `supabase/schema.sql`
- Delivery artifacts: `plans/260731-1539-afs-niche-testing-launcher/plan.md` (updated with code-review section)
- Security gate: `lib/afs/risk-keywords.ts` (new file, keyword blocklist extracted from `image_ad_prompt_generator.md`)
- Atomic claim pattern: `lib/afs/publish-step.ts:90-110` (approximate — claim-sentinel UPDATE before FB calls)
