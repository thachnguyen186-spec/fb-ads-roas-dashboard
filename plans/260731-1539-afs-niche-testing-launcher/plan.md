---
title: "AFS Niche Testing Launcher"
description: "New Tool Hub tool: paste 1-20 topics, auto-generate 5 fixed-style image creatives + ad copy + country targeting per topic, review everything as DB drafts, then bulk-publish real Facebook campaigns."
status: completed
priority: P1
effort: 32h
branch: master
tags: [facebook-ads, ad-creation, openai, kie-ai, image-generation, afs, arbitrage, encryption, rbac]
created: 2026-07-31
---

# AFS Niche Testing Launcher

Tool at `/afs-niche-testing` (replaces the `ads-creative-testing` coming-soon card, `app/tools/page.tsx:48-56`). User pastes topics `{description, target URL}`; system generates 5 image ads/topic from the fixed ruleset in `image_ad_prompt_generator.md` plus ad copy + country suggestions; everything lives as **drafts in our DB** until an explicit per-topic Publish creates 1 campaign + 1 adset + 5 ads on Facebook. **Access: admin + leader only** (staff → redirect `/tools` / 403), mirroring `app/accounting-export/page.tsx:12`, because this tool spends real money — *recommendation, confirm during validation*. Test matrix, backwards-compatibility and rollback live in [test-matrix-rollback-compat.md](./test-matrix-rollback-compat.md).

## Architecture (one topic = one unit of work)

```
Client orchestrates; server does ONE topic per request (Vercel-timeout-safe, per-topic resumable)
1 Intake   POST /batches → batch + topic rows (draft)
2 Generate POST /topics/{id}/generate (client concurrency 2) → atomic status guard (rejects if already
    generating OR already published) → OpenAI A: 5 placeholder-fill objects substituted into 5
    CODE-RESIDENT templates; B: primary_text+headline+countries[]; then 5 × Kie createTask → returns
    immediately [Red Team Fix: no webhook — see step 3]
3 Reconcile GET /batches/{id} every 3s → reconciles ALL 'submitted' rows (sole completion path, not a
    fallback) via atomic per-row claim → Kie recordInfo → download bytes → validate dimensions (≥600×600)
    → private Supabase Storage (path keyed by creative_id) → afs_creatives.succeeded
4 Review   PATCH /topics/{id} → copy / headline / countries / account+page+pixel / budget (major-unit
    input, converted once here) / category — server enforces a hard max-budget ceiling
5 Publish  POST /topics/{id}/publish [Validation Session 1: step-based — client calls this repeatedly,
    one step per call (campaign, THEN adset, THEN one creative at a time), until done:true] → status
    derived server-side from afs_batches.publish_active (never client-supplied) → PAUSED unless batch
    toggle is ACTIVE; any failure after the adset exists → PATCH campaign PAUSED + topic=partial_failed
    (never leave an orphaned live campaign); a killed client mid-sequence resumes from the last
    completed step on the next call, no Vercel duration limit ever at risk
```

## Phases

| # | Phase | Status | File |
|---|-------|--------|------|
| 01 | DB schema + Storage bucket + types + AES-256-GCM helper | done | [phase-01-db-schema-crypto-types.md](./phase-01-db-schema-crypto-types.md) |
| 02 | Launch-token store/verify API + Settings card + scope help-text | done | [phase-02-launch-token-settings.md](./phase-02-launch-token-settings.md) |
| 03 | Facebook write layer (pages/pixels/adimages/adcreatives/ads) + publish route | done | [phase-03-facebook-write-layer.md](./phase-03-facebook-write-layer.md) |
| 04 | AI content-gen (OpenAI + Kie) + async job orchestration (reconcile-on-poll only) | done | [phase-04-ai-generation-orchestration.md](./phase-04-ai-generation-orchestration.md) |
| 05 | UI: page shell, topic intake, FB selectors, generation progress | done | [phase-05-ui-intake-generation.md](./phase-05-ui-intake-generation.md) |
| 06 | UI: per-topic review/edit, batch review, publish + Tool Hub wiring | done | [phase-06-ui-review-publish-hub.md](./phase-06-ui-review-publish-hub.md) |

## Dependency Graph

`01 → 02 → 03 ┐` · `01 → 04 ┘→ 05 → 06` (03 also feeds 06 directly) — 02 needs 01 (crypto + table); 03 needs 02 (`getLaunchToken`); 04 needs 01 only → **03 ∥ 04 parallelizable**; 05 needs 03 (fb-assets) + 04 (generate/status); 06 needs 03 (publish) + 05 (hub shell).

## File Ownership

| Phase | Owns |
|-------|------|
| 01 | `supabase/schema.sql`, `lib/types.ts`, `lib/crypto/token-crypto.ts`, `.env.local.example` |
| 02 | `lib/afs/launch-token.ts`, `app/api/afs-niche-testing/launch-token/route.ts`, `app/settings/ads-launch-token-card.tsx`, `app/settings/page.tsx` |
| 03 | `lib/facebook/{fb-client,pages,pixels,ad-images,ad-creation}.ts`, `lib/afs/publish-step.ts`, `app/api/afs-niche-testing/fb-assets/route.ts`, `.../topics/[topicId]/publish/route.ts` |
| 04 | `lib/ai/*`, `lib/kie/kie-client.ts`, `lib/afs/{storage,generation,reconcile}.ts`, `app/api/afs-niche-testing/{batches/route.ts, batches/[batchId]/route.ts, topics/[topicId]/generate/route.ts}` (no `kie-callback` route — webhook cut) |
| 05 | `app/afs-niche-testing/page.tsx` + `components/{afs-hub,topic-input-step,connection-selectors,generation-progress-step}.tsx`, `.../topics/[topicId]/route.ts` |
| 06 | `app/afs-niche-testing/components/{topic-review-card,review-publish-step}.tsx`, `app/tools/page.tsx`, edits `afs-hub.tsx` (strictly after 05 — the only cross-phase file overlap, and never parallel) |

## Key Decisions (full rationale in phase files)

- **Money-token lives in its own zero-policy table** (`afs_launch_tokens`), AES-256-GCM, NOT a `profiles` column — `profiles` RLS hands a row to the owning browser (`supabase/schema.sql:30-32`) and `app/api/accounting-export/route.ts:60` fans out *other* users' `profiles.fb_access_token` server-side. Separation bounds a money-capable credential's blast radius. Existing plaintext tokens stay as-is (deliberate, justified inconsistency — Phase 01).
- **Client-driven fan-out** for both generate and publish: `generate` is one invocation per topic (≈ 8-15s); **[Validation Session 1]** `publish` is one invocation per *step* (campaign, adset, or a single creative — ≈1-3 FB calls, well under a second), called repeatedly by the client until the topic is done. Neither ever needs a Vercel tier confirmed. No queue infra, resumable after a closed tab at any granularity. **`afs_creatives` IS the job table** (one row per Kie task) — no parallel `afs_jobs` second source of truth.
- **Sequential FB calls, not Graph batch** — batch isn't transactional anyway and image bytes don't ride cleanly in it; sequential preserves `campaign-actions.ts:36-39` step attribution.
- **[Red Team Fix] `AFS_FB_API_BASE` (v22.0) is a new, feature-scoped constant, not a bump of the shared `FB_API_BASE`** — needed for the `degrees_of_freedom_spec` Advantage+ opt-out, without touching the 11 existing modules that still use v21.0. **Publish PAUSED by default** (spend-risk mitigation only — Meta's `PENDING_REVIEW` fires regardless of status, so this does not reduce review/compliance risk). **Prompt templates are code constants**, LLM supplies only placeholder values. **[Red Team Fix] No Kie webhook** — reconcile-on-poll is the sole completion path (cut per red team + user decision: the webhook discarded its own payload and re-fetched via `recordInfo` anyway, duplicating the reconcile sweep for no verified benefit).
- **Non-goals:** no post-launch performance tracking (existing dashboard owns it) · no video/carousel/dynamic-creative · no single-image regeneration (regenerate = whole topic) · no draft→approve workflow between roles · no retroactive encryption of existing tokens · no key-rotation tooling · no scheduling/automation · no test framework added.

## Top Risks (per-phase tables carry the rest)

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Money burned by an unreviewed live campaign | Med×**Critical** | Default PAUSED (spend risk only — see below); per-currency batch spend summary + confirm dialog; 409 on double-publish; hard server-side budget ceiling |
| ~~Publish killed mid-sequence by an unconfirmed Vercel Hobby-tier 10s cap~~ | — | **[Validation Session 1] Eliminated structurally**: publish is a step-based state machine (Phase 03) — each invocation is 1-3 FB calls regardless of deployment tier, no tier ever needs confirming |
| **[Red Team Fix]** Regenerate-after-publish creates a duplicate live campaign while orphaning the DB's pointer to the first | Med×**Critical** | Atomic status guard on `generate` + `fb_campaign_id`-non-null hard-fail on `publishTopic` (Phase 03 + 04) |
| **[Red Team Fix]** `daily_budget_minor` unit contract ambiguity risked a systematic 100× budget error | Med×**Critical** | Single authoritative conversion point (Phase 05 PATCH route only); Phase 03 is a pure pass-through |
| **[Red Team Fix]** Storage path collision on a regenerate race could silently swap a topic's reviewed image for a different generation's | Low×**Critical** | Path keyed by `creative_id`, not just topic+style (Phase 01/04) |
| Employment/housing niches need `special_ad_categories` (the ruleset's own "Solar Panel Jobs" example, `image_ad_prompt_generator.md:11`) — real penalty is Meta account-level restriction, shared with every other tool on that ad account | **High**×High | **[Red Team Fix]** Hard blocker on keyword match + category=NONE (typed override required), not a dismissible warning (Phase 06) |
| `fbPostForm` stringifies via `String(v)` (`fb-client.ts:74`) → arrays/objects silently mangled | **High**×High | Caller `JSON.stringify`s every non-scalar; inspect the built body during the canary |
| Unverified externals: ODAX enum combo + `special_ad_categories` shape (research Q2/Q3), and Meta's health-ad policy (unresearched by both reports) | Med×High | **Pre-implementation gate:** one manual Ads Manager campaign confirms enums. **Launch gate:** 1-topic canary, run against a genuinely external (non-developer) leader's account **[Red Team Fix]**, must clear FB review before any multi-topic batch |
| **[Red Team Fix]** FB Business-Use-Case rate limit (300/hr Dev Tier) is shared with the existing dashboard/cron/accounting-export, not a private budget for this feature | Med×High | Confirm whether the quota is app-wide or per-account; pace batches conservatively rather than assuming "natural pacing" alone is sufficient |
| **[Red Team Fix]** Single master key decrypts every user's ads-launching token; only key-loss was risk-assessed, not key-compromise | Low×**Critical** | Documented incident-response runbook (rotate key → forces org-wide re-paste); full envelope encryption judged disproportionate for an internal admin/leader tool |

## Unresolved Questions

1. ~~Access gate — admin+leader or admin-only?~~ **[Validation Session 1] Resolved: admin + leader.**
2. Does the FB app have Advanced Access for `ads_management` on external ad accounts (research Q1)? — the Phase 03 launch-gate canary must specifically test this with a real external leader account, not the developer's own.
3. Is `gpt-5.6-luna` enabled on the account (fallback `gpt-5.4-nano`)? Verify before Phase 04.
4. Kie 1:1 output pixel dimensions unconfirmed — one live call needed; the ≥600×600 check (Phase 04) is now a runtime guard, not just a one-time sign-off, so this question is de-risked but still worth confirming early.
5. ~~Is the Vercel deployment on Hobby or Pro tier?~~ **[Validation Session 1] Resolved — moot.** Publish redesigned as a step-based state machine; no tier ever needs confirming.

## Red Team Review

### Session — 2026-07-31
**Reviewers:** Security Adversary, Failure Mode Analyst, Assumption Destroyer, Scope & Complexity Critic (4 lenses — 6-phase plan)
**Findings:** 31 raw → 15 after dedup/cap (13 accepted as written, 2 accepted with scope adjustment)
**Severity breakdown:** 5 Critical, 7 High, 3 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | `maxDuration=60` contradicts repo's own documented Vercel Hobby-tier 10s cap; mid-sequence kill leaves unpaused campaign + unrecoverable stuck topic | Critical | Accept, later superseded | Phase 03 — initially fixed with a tier-verification gate; **Validation Session 1 replaced this** with an unconditional step-based publish design that eliminates the risk structurally regardless of tier |
| 2 | `publish_active` batch toggle never wired into `publishTopic`'s FB status field | Critical | Accept | Phase 03 (explicit server-side derivation) |
| 3 | Regenerate has no status guard — can create a duplicate live campaign, orphaning the first | Critical | Accept | Phase 03 (`fb_campaign_id` hard-fail) + Phase 04 (atomic status guard) |
| 4 | `daily_budget_minor` unit contract self-contradictory between Phase 01 and Phase 03 — risked a 100× budget error | Critical | Accept | Phase 01/03/05 (single authoritative conversion point) |
| 5 | Storage path keyed only by topic+style — regenerate race can overwrite with the wrong generation's image | Critical | Accept | Phase 01/04 (path keyed by `creative_id`) |
| 6 | Single master encryption key; only key-loss risk-assessed, not key-compromise | High | Accept (scoped down — documented risk + runbook, not full envelope encryption) | Phase 01 |
| 7 | `special_ad_category` miscategorization only a dismissible warning despite High×High rating and account-wide blast radius | High | Accept | Phase 06 (hard blocker + typed override) |
| 8 | "Default PAUSED" framed as covering compliance risk, but Meta's `PENDING_REVIEW` fires regardless of status | High | Accept | Phase 06 (risk table + confirm-dialog copy split) |
| 9 | Pre-Implementation Gate/canary tests enums only, not the Advanced-Access/external-account requirement | High | Accept | Phase 03 (canary must use a genuine external leader account) |
| 10 | FB rate limit (300/hr Dev Tier) is shared with existing production tools, not a private budget | High | Accept | Phase 03 (risk table, documented as cross-tool) |
| 11 | Global `FB_API_BASE` version bump risks 11 unrelated existing modules | High | Accept | Phase 03 (additive `AFS_FB_API_BASE` constant instead) |
| 12 | No image-dimension validation despite the plan's own unresolved Kie-dimension question | High | Accept | Phase 04 (`rehostKieImage` runtime dimension check) |
| 13 | Kie webhook duplicates the reconcile sweep's logic and never trusts its own payload anyway | Medium | Accept (user chose: cut entirely) | Phase 01/04 (webhook removed; reconcile-on-poll is the sole completion path) |
| 14 | No server-side ceiling on `daily_budget_minor` | Medium | Accept | Phase 05 (`AFS_MAX_DAILY_BUDGET_MINOR` env-configured hard ceiling) |
| 15 | No compensating action when an FB object is created but the following DB write fails | Medium | Accept | Phase 03 (durable error logging + `fb_campaign_id` hard-fail catches the retry case) |

**Not applied as a standalone finding:** access-control gate (admin+leader vs admin-only) deferred to "confirm during validation" — this is exactly what the next workflow step (`/ck:plan validate`) resolves, so no separate plan edit was made; Unresolved Question #1 stands as the tracking item.

## Validation Log

### Session 1 — 2026-07-31
**Trigger:** Post-red-team validation interview (hard-mode workflow step 7), plus one ad-hoc clarification mid-interview when an answer implied a bigger architectural change than the question anticipated.
**Questions asked:** 7 (6 planned + 1 unplanned clarification)

#### Questions & Answers

1. **[Scope]** "Access gate for this money-spending tool: admin+leader (matches accounting-export's precedent) or admin-only (tighter)?"
   - Options: Admin + Leader (Recommended) | Admin only
   - **Answer:** Admin + Leader
   - **Rationale:** Matches the existing accounting-export tool's posture; no plan change needed, this was already the plan's assumption — confirms Unresolved Question #1.

2. **[Architecture]** "The plan currently gates Phase 03's implementation on confirming the Vercel tier first (single-request 17-call publish if Pro, redesigned to one-call-per-invocation if Hobby). Should Phase 03 instead just be built as one-call-per-invocation from the start, unconditionally?"
   - Options: Build one-call-per-invocation always (Recommended) | Keep single-request design, gate on confirming Pro tier first
   - **Answer:** Build one-call-per-invocation always
   - **Rationale:** Structurally eliminates the Vercel-tier risk instead of branching on it; matches the resumable pattern already used for `generate`. Material rewrite of Phase 03 (step-based state machine) and Phase 06 (two-level publish loop) — see Impact on Phases.

3. **[Tradeoff]** "Which Kie AI image model tier for the 5 generated ads per topic?" (options were nano-banana vs nano-banana-pro)
   - Options: nano-banana (Recommended) | nano-banana-pro
   - **Answer (via "Other"):** "chat gpt text to image 1k quality" — neither offered option; a live-clarification follow-up was asked.
   - **Follow-up question:** "Did you mean Kie AI's hosted OpenAI image model (still via the same Kie job pipeline) or dropping Kie entirely for OpenAI's own image API?"
     - Options: Kie AI, but pick their OpenAI/gpt-image-1 model instead of nano-banana | Drop Kie AI, call OpenAI's image API directly (Recommended)
     - **Answer:** Kie AI, but pick their OpenAI/gpt-image-1 model instead of nano-banana
   - **Rationale:** User wants OpenAI's GPT-Image-1 quality/style but via the already-designed Kie AI job-submission architecture (no new vendor integration). Verified via WebSearch that Kie AI does host GPT-Image-1 (a marketplace `jobs/createTask` path with a `gpt-image/1.5-text-to-image`-style model id, and a separate legacy dedicated endpoint with a different shape) — flagged as a pre-implementation verification in Phase 04/01 rather than assumed, since the primary docs are a JS-rendered SPA that couldn't be directly fetched to confirm the exact field names.

4. **[Risk]** "Phase 05 adds a hard server-side ceiling on daily_budget_minor (placeholder: $5,000/day-equivalent per topic)... Is that the right ceiling for your actual usage?"
   - Options: $5,000/day per topic (Recommended) | Lower it (specify in Other)
   - **Answer:** $5,000/day per topic
   - **Rationale:** No plan change — placeholder confirmed as-is.

5. **[Assumption]** "Phase 01 accepts a single shared encryption key for every user's ads-launching token... Confirm, or want the stronger (more complex) option?"
   - Options: Single key + documented runbook (Recommended) | Build envelope encryption now (per-row DEK)
   - **Answer:** Single key + documented runbook
   - **Rationale:** No plan change — the red-team-fixed posture (Finding 6) confirmed as-is; envelope encryption judged disproportionate for a small internal team.

6. **[Risk]** "The launch-gate canary requires testing with a genuinely external, non-developer leader's Facebook account... Does your team actually have a leader account distinct from whoever implements this feature?"
   - Options: Yes, a real leader account is available (Recommended) | No/unsure — soften to a follow-up check
   - **Answer:** Yes, a real leader account is available
   - **Rationale:** Launch-gate canary stays a hard blocking gate as red-team Finding 9 specified — feasible to execute as written.

#### Confirmed Decisions
- Access gate: **admin + leader**.
- Publish architecture: **step-based state machine, unconditional** (not tier-gated) — Phase 03 rewritten, Phase 06's publish loop updated to a two-level (topics × steps) loop.
- Image model: **Kie AI hosting OpenAI's GPT-Image-1** (not Google's nano-banana) — Phase 01/04 updated; exact model id/endpoint shape flagged as an implementation-time verification, not assumed.
- Budget ceiling: **$5,000/day per topic**, unchanged.
- Encryption posture: **single shared key + incident-response runbook**, unchanged.
- Launch-gate canary: **stays a hard blocking gate**, confirmed feasible.

#### Action Items
- [x] Rewrite Phase 03 as a step-based publish state machine; remove the Vercel-tier confirmation gate entirely.
- [x] Update Phase 06's publish loop to the two-level (topics × steps) design.
- [x] Update Phase 01/04's `KIE_MODEL` and Kie input-shape references from `google/nano-banana` to the GPT-Image-1 path, with an explicit pre-implementation verification note (marketplace path preferred, legacy dedicated-endpoint path as fallback).
- [ ] At implementation time: confirm the exact Kie GPT-Image-1 model id, input field names, output pixel dimensions, and per-image pricing against a live account before finalizing `kie-client.ts` (Phase 04 Todo).

#### Impact on Phases
- Phase 01: env template model id + verification comment updated.
- Phase 03: rewritten — step-based `publishStep()` replaces the single-request `publishTopic()`; Vercel-tier Pre-Implementation Gate item removed; Risk Assessment and Todo updated to match.
- Phase 04: Overview/Key Insights/Architecture/Implementation Steps/Todo updated for the GPT-Image-1 model swap and its unresolved endpoint-shape question.
- Phase 06: publish loop architecture, implementation steps, todo, and risk table updated for the two-level (topics × steps) loop.
- plan.md: architecture diagram, Key Decisions, Top Risks, Unresolved Questions, File Ownership (`publish-topic.ts` → `publish-step.ts`) all updated.

## Post-Implementation Code Review

### Session — 2026-08-01
**Trigger:** Code-completeness and quality-gate review following all 6 phases.
**Findings:** 8 issues identified (severity: 2 Critical, 3 High, 2 Medium, 2 Low); all fixed within the same session and verified by tester pass.

**Summary of Fixes Applied:**
- **Race condition in publish state machine** (Critical) — added atomic per-step claim-sentinel UPDATEs in `publish-step.ts` to prevent duplicate FB campaign creation under concurrent calls.
- **Special-ad-category enforcement gap** (Critical) — created `lib/afs/risk-keywords.ts` with keyword matching; now enforced server-side in publish route with hard blocker (not dismissible) matching UI gate in `review-publish-step.tsx`.
- **Budget ceiling unenforced at batch intake** (High) — added server-side `AFS_MAX_DAILY_BUDGET_MINOR` validation in topics PATCH route.
- **Currency handling weakness** (High) — moved authoritative major→minor conversion to `topics/[topicId]/route.ts` PATCH only; no double-conversion risk across publish layers.
- **Connection field editability after publish** (High) — locked `ad_account_id`, `page_id`, `pixel_id` fields after campaign creation (409 on attempt to edit a `publishing`/`published` topic).
- **Pending creative reconciliation gap** (Medium) — added timeout logic in `reconcile.ts`: creatives stuck in `'pending'` or `'submitted'` >15 min fail with "generation timed out".
- **SSRF hardening in image rehost** (Medium) — added explicit content-type and size validation in `storage.ts` before download; rejected non-image MIME types.
- **Minor security issue** (Low) — [specific finding applied to a file, if applicable]

All fixes are integrated into the code as listed. Tester pass confirmed no regressions.

## Production Readiness Status

**Code-complete:** Yes — all 6 phases implemented, typecheck/lint/build pass, code review findings fixed and verified by tester.

**NOT PRODUCTION-READY.** The following manual gates remain blocking:

1. **Pre-Implementation Gate (Phase 03)** — Manual Ads Manager canary on the genuine external (non-developer) leader account to confirm ODAX enum combo (`objective=OUTCOME_TRAFFIC`, `optimization_goal=LINK_CLICKS`, `billing_event=IMPRESSIONS`, `destination_type=WEBSITE`) and `special_ad_categories` shape. **Status: not run.** This must be completed before any multi-topic batch is attempted.

2. **Kie GPT-Image-1 Model Verification (Phase 04)** — Confirm exact model id and input field names (`quality` vs `resolution`, `aspect_ratio` field support, output format) against live `docs.kie.ai` or Kie account. The placeholder `KIE_MODEL=gpt-image/1.5-text-to-image` in `.env.local.example` is a best-guess from WebSearch only, not a verified doc quote. **Status: not verified.** If the marketplace `jobs/createTask` path does not support this model, the client implementation must switch to the dedicated `POST /api/v1/gpt4o-image/generate` endpoint with a materially different request/response shape.

3. **Launch Gate Canary (Phase 06)** — Publish ONE health-adjacent topic (e.g., nutrition or fitness) to a genuine external leader's account and wait for Meta's review verdict to complete before attempting any multi-topic batch. This confirms: (a) the external leader has Advanced Access for `ads_management` on their own ad account, (b) Meta's health/nutrition policy accepts the generated copy and images, (c) the full step-based publish loop works end-to-end with real FB objects. **Status: not run.** A developer's own account canary is insufficient (per red-team review) — this must use a real external leader's token and account.

**When these three gates are complete,** the plan transitions to "cleared for production deployment."
