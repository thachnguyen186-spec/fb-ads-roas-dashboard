# Phase 03 — Facebook Write Layer + Step-Based Publish Route

## Context Links
- FB wrapper: `lib/facebook/fb-client.ts` (base const **line 6**; error parse 10-19; `fbPostForm` **72-76** — note `String(v)`)
- Write precedent + step-error pattern: `lib/facebook/campaign-actions.ts:19-21` (`pauseCampaign`), `36-39` (`stepError`), `145` (VND/USD minor-unit rule)
- Pagination precedent: `lib/facebook/ad-accounts.ts:25-45`
- Research: `plans/reports/researcher-260731-1539-fb-marketing-api-ad-creation.md` §1-8
- Token helper: `lib/afs/launch-token.ts` (Phase 02)

## Overview
- **Priority:** P0
- **Status:** pending · **Effort:** 7h
- **Description:** Everything that talks to Facebook's write endpoints: list Pages/Pixels, upload images, create campaign→adset→creatives→ads for one topic. **[Validation Session 1]** Publish is a **step-based state machine** — each `POST /publish` call advances one step (create campaign, OR create adset, OR publish one creative) and returns immediately; the client calls it repeatedly until done. This was chosen over a single long-running request during validation: it mirrors Phase 04's `generate` (one topic per invocation) pattern one level finer-grained, works identically on any Vercel tier, needs no tier-confirmation gate, and every step persists its result before returning — a killed invocation mid-batch just means the next client call resumes from the last completed step, never an unpaused orphan.

## Pre-Implementation Gate (do this first, it is not optional)
Research Q2/Q3 could not confirm the ODAX enum matrix or `special_ad_categories` shape from primary docs. **Before writing `ad-creation.ts`, create one traffic campaign manually in Ads Manager** on a real ad account and confirm: `objective=OUTCOME_TRAFFIC`, `optimization_goal=LINK_CLICKS`, `billing_event=IMPRESSIONS`, `destination_type=WEBSITE`, and whether `special_ad_categories` accepts `[]`. Record findings at the top of `ad-creation.ts` as a comment. Wrong enums = a full batch of rejected API calls.

**[Red Team Fix] This manual campaign must NOT be run under the implementing developer's own Business Manager access.** Research §6 flags that `ads_management` requires App Review/Advanced Access once the app operates on ad accounts *outside* its own Business Manager — a canary run by a developer/tester (who almost certainly already has Standard Access on their own accounts) will pass regardless of whether this gap exists for a real leader's external account. **[Validation Session 1: confirmed a real external leader account is available]** The **Launch Gate** 1-topic canary (Phase 06 Todo) must specifically use a launch token from that genuine team-member leader account on their own external ad account, not a developer's, before any multi-topic batch is declared safe.

## Key Insights
- **`fbPostForm` mangles non-scalars.** `fb-client.ts:74` does `String(v)` → `String([])` is `''` and `String({})` is `'[object Object]'`. Every array/object param (`special_ad_categories`, `targeting`, `object_story_spec`, `degrees_of_freedom_spec`, `creative`, `promoted_object`) **must be `JSON.stringify`'d by the caller**. This is the single most likely silent-failure source in the phase.
- **[Red Team Fix] Version bump is AFS-scoped, not global.** `degrees_of_freedom_spec.creative_features_spec.standard_enhancements.enroll_status: "OPT_OUT"` (needed so Advantage+ doesn't retouch/overlay images whose headline+CTA are baked in) requires MAPI v22.0+. Rather than bumping the shared `FB_API_BASE` constant in `fb-client.ts:6` — which is used by all 11 existing FB modules (dashboard, spend-limits cron, campaign duplication, TikTok-adjacent code) and would force a full-app regression pass for one new feature's requirement — add a **second, AFS-only constant** `AFS_FB_API_BASE = 'https://graph.facebook.com/v22.0'` used exclusively by the new `pages.ts`/`pixels.ts`/`ad-images.ts`/`ad-creation.ts` modules. `fbGet`/`fbPatch`/`fbPostForm`/`fbPostMultipart` all accept an optional base-URL override (default stays v21.0 for every existing call site). Zero regression risk to existing tools; no smoke-list needed for unrelated modules.
- **[Validation Session 1] Step-based publish, not a single 17-call sequence.** Each invocation of `POST /topics/{id}/publish` does exactly ONE of: create campaign, create adset, or publish one creative (image upload + creative + ad, ~3 FB calls). It persists the result and returns `{ done: false, nextStep }` (or `{ done: true, status }` on the final call). The client (Phase 06) loops calling it until `done`. This structurally eliminates any dependency on function-duration limits — no Vercel tier ever needs confirming, and no contingency branch is needed (replaces the original tier-gated design).
- **Multipart for `/adimages`.** Add `fbPostMultipart` rather than base64-in-urlencoded: FormData + Blob is the documented upload shape, avoids ~+33% base64 growth plus percent-encoding on top, and sidesteps any body-size ambiguity. Response is a map keyed by filename → read `Object.values(res.images)[0].hash`.
- **Pixel is optional** for `LINK_CLICKS` traffic; the destination is a third-party AFS page we own no events on. Send `promoted_object` only when the user picked a pixel.
- **[Red Team Fix] Budget is a pure pass-through, not a conversion.** Per Phase 01's authoritative unit contract, `topic.daily_budget_minor` already holds FB-ready minor units by the time it reaches this layer. `ad-creation.ts` does **not** call a `minorBudget()`/re-conversion function — it sends `daily_budget: String(topic.daily_budget_minor)` directly. (An earlier draft of this phase incorrectly proposed reusing `campaign-actions.ts:145`'s major-unit-input conversion here, which would have double-converted and caused a 100× budget error — that conversion happens exactly once, in Phase 05's PATCH route.)
- **Idempotency, two layers deep:**
  1. Each step persists its FB id (`fb_campaign_id`, `fb_adset_id`, or per-creative `fb_image_hash`/`fb_creative_id`/`fb_ad_id`) **before** returning — the next call re-reads the topic/creatives from the DB to decide the next step, never from client-supplied state.
  2. **[Red Team Fix] The route hard-fails a fresh publish attempt if `topic.fb_campaign_id` is already non-null and no more steps remain** (i.e. the topic is fully `published`), independent of the status guard. This closes the "regenerate after publish" gap (Finding 3, Phase 04's fix): even if the `generate`/status guard were ever bypassed, publish refuses to create a second campaign for a topic that already has one — `Error('Topic already has a live campaign (fb_campaign_id set) — cannot re-publish. Contact an admin if this campaign needs to be replaced.')`.
  3. **[Red Team Fix] Compensating action when an FB call succeeds but the follow-up DB write fails:** if the Supabase persist throws after a successful FB create, the handler does not swallow the FB object id — it's included in the thrown error message so it surfaces to the user/logs, and the topic is left in a state (`error` populated, status unchanged) that the `fb_campaign_id`-non-null hard-fail will catch on any retry rather than allowing a duplicate.

## Requirements
- `fetchPages(token)`, `fetchPixels(token, accountId)` — paginated, same shape as `ad-accounts.ts`.
- `uploadAdImage(token, accountId, bytes, filename) → image_hash`.
- `publishStep(userId, topicId)` → advances the topic's publish state machine by exactly one step; returns `{ done: boolean, step?: 'campaign'|'adset'|'creative', creativeIndex?: number, result?: AfsPublishResult }`.
- Any failure after the adset exists ⇒ campaign PAUSED + `topic.status='partial_failed'` once all creative steps have been attempted.

## Architecture

```
POST /api/afs-niche-testing/topics/{id}/publish   [Validation Session 1: called repeatedly by the client
                                                     until it reports done:true — one step per call]
  auth → requireRole(admin|leader) → load topic (own row) → guard status ∈ {ready, partial_failed, publishing}
  → getLaunchToken(userId) → load afs_batches row for topic.batch_id → publishStep()

publishStep(topic, creatives[], batch, token):
  0 [Red Team Fix] targetStatus = batch.publish_active ? 'ACTIVE' : 'PAUSED'  — the ONLY place this is
                                                                                decided; never client-supplied
  if topic.fb_campaign_id IS NULL:
      → set topic.status='publishing' (first call only)
      POST /act_{acct}/campaigns  name, objective=OUTCOME_TRAFFIC, status=targetStatus,
            special_ad_categories=JSON([] | [CATEGORY])           → persist fb_campaign_id → return
            { done:false, step:'campaign' }
  else if topic.fb_adset_id IS NULL:
      POST /act_{acct}/adsets  campaign_id, daily_budget=topic.daily_budget_minor (pass-through, NOT
            re-converted — see Key Insights budget note), billing_event=IMPRESSIONS,
            optimization_goal=LINK_CLICKS, destination_type=WEBSITE, bid_strategy=LOWEST_COST_WITHOUT_CAP,
            targeting=JSON({geo_locations:{countries}}), [promoted_object=JSON({pixel_id})]
                                                                    → persist fb_adset_id → return
            { done:false, step:'adset' }
  else if a succeeded creative with fb_ad_id IS NULL exists (pick the lowest `position`):
      download bytes from Supabase Storage (service client)
      POST /act_{acct}/adimages  (multipart)                      → fb_image_hash
      POST /act_{acct}/adcreatives  object_story_spec=JSON({page_id, link_data:{
             link: target_url, message: primary_text, name: ad_headline, image_hash,
             call_to_action:{type:'LEARN_MORE', value:{link: target_url}}}}),
           degrees_of_freedom_spec=JSON({creative_features_spec:{standard_enhancements:
             {enroll_status:'OPT_OUT'}}})                          → fb_creative_id
      POST /act_{acct}/ads  name, adset_id, creative=JSON({creative_id}), status=targetStatus
                                                                     → fb_ad_id
      on error → record per-creative error, persist, return { done:false, step:'creative', creativeIndex }
                 (client keeps calling — next call skips this creative, tries the next one)
      on success → return { done:false, step:'creative', creativeIndex }
  else (no more creatives to attempt):
      if any creative has an error → pauseCampaign(token, fb_campaign_id); status='partial_failed'
      else status='published'
      → return { done:true, result: AfsPublishResult }
```

## Related Code Files
**Modify:** `lib/facebook/fb-client.ts` (`fbGet`/`fbPatch`/`fbPostForm` gain an optional base-URL override param + `fbPostMultipart`)
**Create:** `lib/facebook/pages.ts`, `lib/facebook/pixels.ts`, `lib/facebook/ad-images.ts`, `lib/facebook/ad-creation.ts`, `lib/afs/publish-step.ts`, `app/api/afs-niche-testing/fb-assets/route.ts`, `app/api/afs-niche-testing/topics/[topicId]/publish/route.ts`

## Implementation Steps
1. Run the Pre-Implementation Gate (manual campaign on the genuine external leader account); write findings into `ad-creation.ts`'s header comment.
2. `fb-client.ts`: add `AFS_FB_API_BASE = 'https://graph.facebook.com/v22.0'` (existing `FB_API_BASE` for v21.0 untouched); `fbGet`/`fbPatch`/`fbPostForm` accept an optional `baseUrl` param (default `FB_API_BASE`). Add `fbPostMultipart(path, files, fields, token, baseUrl?)` using `FormData`/`Blob` (Node 20 globals), reusing `parseAndThrow`.
3. `pages.ts` — `GET /me/accounts?fields=id,name&limit=100` against `AFS_FB_API_BASE`, cursor loop. On `(#200)`/permission error, throw `Error('Facebook Pages unavailable — your launch token is missing pages_show_list. Re-verify it in Settings.')` (actionable, not raw).
4. `pixels.ts` — `GET /act_{id}/adspixels?fields=id,name&limit=100` against `AFS_FB_API_BASE`. Treat an error here as **non-fatal**: return `[]` + a warning string, since pixel is optional.
5. `ad-images.ts` — `uploadAdImage()`; validate `bytes.length > 0` and `< 8MB`; parse `Object.values(json.images)[0].hash`; throw `Error('adimages returned no hash')` if absent.
6. `ad-creation.ts` — `createCampaign`, `createAdSet`, `createAdCreative`, `createAd`; each a thin `fbPostForm` call (against `AFS_FB_API_BASE`) returning `{id}`; every non-scalar param `JSON.stringify`'d. **No budget conversion function** — `daily_budget` is `String(topic.daily_budget_minor)`, passed through unchanged (Phase 01's authoritative unit contract).
7. `lib/afs/publish-step.ts` — the single-step state machine above, using the `stepError()` pattern; picks the next incomplete step by re-reading DB state each call (never trusts anything from the previous invocation); writes `fb_*` ids **as each step succeeds** (service client), with the DB-write-failure compensating action from Key Insights.
8. `fb-assets/route.ts` — `GET ?accountId=` → `{ pages, pixels, warnings[] }`; also returns the user's `fb_ad_accounts` rows (service client, own `user_id`) so the UI has all three dropdowns from one call.
9. `publish/route.ts` — auth, role gate, ownership check, status guard (accepts `ready`/`partial_failed`/`publishing` — the latter because the client re-calls it mid-sequence; rejects `published` with the `fb_campaign_id`-non-null hard-fail), calls `publishStep()` once, returns its result. No `maxDuration` tuning needed — each call is 1-3 FB requests, safely under any tier's default limit.
10. Typecheck, lint, build.

## Todo List
- [ ] Manual Ads Manager canary on the genuine external (non-developer) leader account → record confirmed enums [PRE-IMPLEMENTATION GATE — BLOCKED: requires external leader account]
- [x] Add `AFS_FB_API_BASE` (v22.0) constant + optional `baseUrl` param on `fbGet`/`fbPatch`/`fbPostForm` + `fbPostMultipart` — **existing `FB_API_BASE`/v21.0 and all 11 existing modules stay untouched**
- [x] `pages.ts`, `pixels.ts`, `ad-images.ts`, `ad-creation.ts` (no budget-conversion function — pass-through only)
- [x] `publish-step.ts` — single-step state machine, re-reads DB each call, `fb_campaign_id` non-null hard-fail, `publish_active`-derived status, per-step id persistence + DB-write-failure compensating action (includes race-condition fix from code review)
- [x] `fb-assets` + `publish` routes with auth/role/ownership/status guards
- [ ] End-to-end: publish ONE topic to a real account via repeated client calls (PAUSED), verify in Ads Manager — confirm it completes correctly across ~9 separate `publish` calls (1 campaign + 1 adset + 5 creatives + 2 no-op/finalize calls, approximately) [LAUNCH GATE — BLOCKED: requires external leader account]
- [ ] Manual: kill the client mid-sequence (close tab after the campaign step) and resume — confirms no duplicate campaign, no orphan [BLOCKED: requires live testing]
- [ ] Verify `special_ad_categories` with `EMPLOYMENT` on a jobs-style topic [BLOCKED: requires FB publish]
- [ ] Verify a VND (non-USD, no-sub-unit) account publishes the correct budget with no 100× error [BLOCKED: requires VND account]
- [x] Typecheck + lint + build

## Success Criteria
- One topic publish (via repeated client calls) produces exactly 1 campaign, 1 adset, and one ad per succeeded creative, at the status derived from `afs_batches.publish_active` (not a hardcoded/client value), visible in Ads Manager with the correct URL, copy, countries, budget and images rendered unmodified (no Advantage+ overlay).
- Forcing a creative failure (bad image hash) leaves the campaign **PAUSED**, topic `partial_failed`, and per-creative `error` populated — no orphaned live campaign.
- Interrupting the client between any two steps and resuming later completes the topic correctly with no duplicate FB objects.
- Attempting to publish an already-`published` topic (or any topic with `fb_campaign_id` already set and no remaining steps) returns an error and creates nothing.
- Pixel-less topic publishes fine; missing `pages_show_list` yields the actionable message, not a raw FB trace.
- Existing dashboard tools are provably untouched — they still call `FB_API_BASE`/v21.0, `AFS_FB_API_BASE` is additive only.

## Risk Assessment
| Risk | L | I | Mitigation |
|------|---|---|-----------|
| Array/object params silently sent as `''`/`[object Object]` | High | High | `JSON.stringify` at every call site; log the built body once during the canary and eyeball it |
| Wrong ODAX enum combo → every publish 400s | Med | High | Pre-Implementation Gate (manual campaign first) |
| **[Red Team Fix]** Canary/manual test run under the developer's own Business Manager access masks an Advanced-Access gap for real external leader accounts | Med | High | **[Validation Session 1: confirmed available]** Launch-gate canary (Phase 06) uses the genuine external leader's token, not the developer's |
| AFS-only version bump breaks an existing read module | ~Zero | High | Additive `AFS_FB_API_BASE` constant; existing `FB_API_BASE`/v21.0 call sites are never touched, so this risk is structurally eliminated rather than mitigated |
| Employment/housing topic published with `[]` category | Med | High | Per-topic `special_ad_category` (Phase 01 column), **required explicit acknowledgment** when keyword-matched (Phase 06 fix) |
| Rate limit (Dev Tier 300/hr; ~9 client calls × ~2 FB calls each per topic) shared with existing dashboard/cron/accounting-export | Med | High | Step-based calls are naturally paced by client round-trip time; surface FB code 17/80004 as "slow down, retry in a minute"; confirm whether the quota is app-wide or per-account before assuming this is sufficient at full batch scale |
| Token expires mid-batch | Med | Med | Per-topic failure only; remaining topics stay `ready` and resumable; a topic mid-publish resumes from its last completed step once the token is refreshed |
| Storage download fails mid-publish | Low | Med | That creative is skipped with an error; if all 5 fail → campaign paused, `partial_failed` |
| **[Red Team Fix]** FB object created but the immediate DB persist fails → orphaned untracked campaign, retry creates a duplicate | Low | High | Compensating action: durably log the FB id in the thrown error before returning; `fb_campaign_id`-non-null hard-fail on any subsequent publish attempt catches the retry case |
| Ad account currency ≠ USD (VND) → 100× budget error | Med | High | Single authoritative conversion point (Phase 05 intake), pure pass-through here — eliminates the double-conversion class of bug entirely rather than just testing for it |
| **[Validation Session 1, retired]** ~~Publish killed mid-sequence by Vercel Hobby tier's 10s cap~~ | — | — | **Eliminated structurally**, not mitigated: step-based publish means each invocation is 1-3 FB calls regardless of deployment tier — no tier ever needs confirming |

## Security Considerations
- Launch token is fetched per-request via `getLaunchToken` and never returned to the client or written to logs; FB error strings are surfaced but contain no token.
- Ownership check (`afs_topics.user_id === user.id`) on every route — role alone is not sufficient authorization for another user's topic.
- Image bytes are read with the service client from a **private** bucket; no public URL is ever handed to Facebook.

## Next Steps
- Phase 05 consumes `fb-assets`; Phase 06 consumes `publish` (in its repeated-call loop form).
