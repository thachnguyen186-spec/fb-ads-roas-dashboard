# AFS Niche Testing Launcher — Planning Complete

**Date**: 2026-07-31
**Component**: New dashboard tool / Facebook Marketing API / AI image generation
**Status**: Planning complete (hard mode: research → scope challenge → plan → red-team → validate). No code written.
**Plan**: `plans/260731-1539-afs-niche-testing-launcher/` — `plan.md` + `phase-01-db-schema-crypto-types.md` + `phase-02-launch-token-settings.md` + `phase-03-facebook-write-layer.md` + `phase-04-ai-generation-orchestration.md` + `phase-05-ui-intake-generation.md` + `phase-06-ui-review-publish-hub.md` + `test-matrix-rollback-compat.md`

## What Happened

Planned a new Tool Hub tool: paste a batch of {topic description, target URL} pairs, auto-generate 5 fixed-style image ad creatives per topic (ChatGPT fills a code-resident prompt template, an image-gen API renders it), let the user pick ad account/Page/Pixel/targeting/copy per topic (AI-suggested, editable), review everything as DB-only drafts, then bulk-publish real Facebook campaigns for AdSense-for-Search traffic-arbitrage testing. Ran the full ck-plan hard-mode workflow: scope challenge (HOLD — build exactly what was asked), two parallel researcher agents, a planner subagent, a 4-lens red-team review, and a validation interview that materially changed two architectural decisions mid-stream.

## Key Decisions

**Target repo**: built here (`fb-ads-tools-for-app-iaa`), not the sibling `fb-ads-tool` repo. That sibling has a production Kie AI + multi-LLM content-generation pipeline (used as a design reference only) but zero Facebook Marketing API code and no team-member concept — this repo already has the FB write-path precedent (`campaign-actions.ts`'s campaign-copy flow), team RBAC, and an actual `ads-creative-testing` "coming soon" Tool Hub slot to fill.

**Genuinely new to this repo**: first-ever ad-level Facebook object *creation* (campaign/adset/adcreative/ad — existing code only reads or copies via `/copies`), first AI SDK integration (OpenAI + Kie AI), first crypto code (AES-256-GCM for the new ads-launching token).

**Money-capable token gets its own table.** The new FB token needs `ads_management` scope and can spend real budget, so it lives in a new zero-RLS-policy `afs_launch_tokens` table, AES-256-GCM encrypted — not a `profiles` column, because `profiles`' RLS already hands that row to the owning browser and an existing accounting-export route fans out *other* users' `profiles.fb_access_token` server-side. Existing plaintext tokens stay as-is (deliberate, documented inconsistency). Access gated to admin + leader.

**Kie AI webhook cut.** Original design POSTed a `callBackUrl` to Kie and ran a public callback route, but the callback discarded its own payload and re-fetched via `recordInfo` anyway — duplicated exactly what the reconcile-on-poll sweep already did. Cut entirely: reconcile-on-poll is now the sole completion path, no public unauthenticated route anywhere in the feature.

## Red Team Review — 15 Findings, 5 Critical

Four hostile lenses (Security Adversary, Failure Mode Analyst, Assumption Destroyer, Scope & Complexity Critic) read all 6 phase files and surfaced 31 raw findings, deduplicated to 15. All 15 were fixed directly in the phase files before validation. The 5 Critical ones would have shipped real bugs:

1. **`maxDuration=60` contradicted this repo's own documented Vercel Hobby-tier 10s cap** (`accounting-export/route.ts` already notes it's a no-op on Hobby) — a mid-sequence kill during the original ~17-call publish sequence would leave a live campaign unpaused and the topic stuck unrecoverable in `'publishing'`.
2. **The `publish_active` batch toggle was never actually wired into the FB campaign's status field** — the plan had the toggle and the FB call, but no code path connecting them.
3. **"Regenerate topic" had no guard against a topic that was already published** — could create a second live campaign while overwriting the DB's only pointer to the first, orphaning it.
4. **`daily_budget_minor`'s unit contract was self-contradictory between two phases** — one phase said the column already held FB-ready minor units, another phase called a conversion function that assumed major-unit input — a 100× budget error depending which assumption an implementer picked.
5. **Generated-image storage paths were keyed only by topic+style**, not creative id — a regenerate race before the prior generation finished could silently swap a reviewed image for a different generation's.

The other 10 (7 High, 3 Medium) covered: a single shared encryption key with no key-compromise risk modeled; `special_ad_category` miscategorization (the ruleset's own "Solar Panel Jobs" example is an EMPLOYMENT category) enforced only as a dismissible warning despite account-wide Meta-enforcement blast radius; "default PAUSED" being framed as covering Meta review/compliance risk when `PENDING_REVIEW` actually fires regardless of status; the launch-gate canary only testing ODAX enums, not the separate Advanced-Access/App-Review requirement for external ad accounts; the FB rate limit being treated as feature-private when it's shared with the existing dashboard/cron/accounting-export; a global FB API version bump touching 11 unrelated existing modules instead of a feature-scoped constant; no image-dimension validation despite Kie's output size being unconfirmed; the webhook redundancy noted above; no server-side budget ceiling; and no compensating action when an FB object is created but the DB persist immediately after it fails.

Full disposition table with exact phase-file locations is in `plan.md`'s "Red Team Review" section.

## Validation Interview — Two Architecture Changes

1. **Publish redesigned as an unconditional step-based state machine.** Rather than gating the maxDuration fix on confirming the Vercel deployment tier, `publishStep()` now advances exactly one step per HTTP call (create campaign, OR create adset, OR publish one creative) and the client loops calling it until done — mirrors the existing `generate` route's one-topic-per-invocation pattern, one level finer-grained. This eliminates the Vercel-tier question structurally rather than branching on it (**this is now resolved, not an open blocker** — no tier confirmation is needed under the new design). Phase 03 was rewritten; Phase 06's publish loop became a two-level loop (topics × steps).
2. **Image model pivoted mid-interview.** Asked to pick between Kie's `nano-banana`/`nano-banana-pro` (what the research covered), the answer named "chatgpt text to image 1k quality" instead — a follow-up clarified the user wants Kie AI's *hosted* OpenAI GPT-Image-1 model, not Google's nano-banana, while keeping the same Kie job-submission architecture. Confirmed via live WebSearch that Kie does host GPT-Image-1 (a marketplace `jobs/createTask` path with a `gpt-image/1.5-text-to-image`-style model id, plus a separate legacy dedicated endpoint with a different shape) — but the exact model id and input field names couldn't be confirmed against primary docs (JS-rendered SPA blocks WebFetch), so this is flagged as a **mandatory pre-implementation verification** before Phase 04 is coded, not assumed.

Other validation answers (admin+leader access gate, $5,000/day budget ceiling, single-key encryption posture, launch-gate canary feasibility) confirmed the plan as already written — no changes needed.

## Genuinely Open Before Implementation

- Exact Kie GPT-Image-1 model id / input field names / output pixel dimensions (live-account check, Phase 04 pre-implementation step).
- Whether the FB app has Advanced Access/App Review clearance for ad accounts outside its own Business Manager — a canary publish against a real external leader account is a hard blocking gate before any multi-topic batch (team confirmed such an account exists).
- Meta's own health/medical ad-content policy was never researched by either upstream research report — flagged as a follow-up, not a blocker; the copy-generation prompt uses informational/curiosity framing as a mitigating guideline in the meantime.

## Non-Goals (explicit)

No post-launch performance tracking (existing dashboard owns it), no video/carousel/dynamic-creative ads, no single-image regeneration (regenerate always redoes the whole topic's 5 images), no draft→approve workflow between roles, no retroactive encryption of existing tokens, no key-rotation tooling, no test framework added (repo convention: `tsc --noEmit` + `lint` + `build` + manual test matrix).
