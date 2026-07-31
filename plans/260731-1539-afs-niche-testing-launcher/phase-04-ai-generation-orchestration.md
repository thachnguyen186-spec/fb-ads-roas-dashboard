# Phase 04 — AI Content Generation + Async Job Orchestration

## Context Links
- **Fixed image ruleset (the spec): `image_ad_prompt_generator.md`** — global rules 9-17, 5 templates at 27, 37, 47, 57, 67, headline patterns 71-84
- Research: `plans/reports/researcher-260731-1539-kie-ai-openai-content-generation.md` §1-4
- Bounded-concurrency precedent: `app/api/accounting-export/route.ts:37-52` (`runBatched`), per-user cooldown 32/143-146
- Thin-wrapper convention: `lib/facebook/fb-client.ts`

## Overview
- **Priority:** P0
- **Status:** pending · **Effort:** 7h (reduced from 8h — webhook path cut per red team)
- **Description:** OpenAI (structured JSON) → filled image prompts + ad copy/targeting; Kie AI job submission → 5 images/topic; download → private Supabase Storage; DB-backed status via reconcile-on-poll (sole completion path — no webhook).

**[Red Team Fix] Webhook cut entirely.** The original design also POSTed a `callBackUrl` to Kie and ran a public `kie-callback` route. Red-team review flagged this as duplicated complexity: the callback discarded its own payload and re-fetched via `recordInfo` anyway (for forgery-proofing), which is exactly what the reconcile-on-poll sweep already did independently. Per user decision, the webhook is cut: no public route, no `callback_secret` column, no `AFS_PUBLIC_BASE_URL` env var, no auth-middleware carve-out. Reconcile-on-poll (below) is now the **only** completion path. Trade-off: image-ready feedback lands within one 3s poll cycle instead of near-instantly — acceptable for an internal batch-review tool.

**[Validation Session 1] Image model changed to Kie's hosted GPT-Image-1, not `google/nano-banana`.** User explicitly chose OpenAI's image model ("ChatGPT text-to-image", 1K/high quality) over Google's nano-banana lineup that the original research covered. Confirmed via WebSearch (not the primary docs, which are a JS-rendered SPA WebFetch couldn't render): Kie AI hosts GPT-Image-1 (OpenAI's "4o image" model) reachable two ways — (a) the same generic marketplace `jobs/createTask`/`jobs/recordInfo` pattern this phase already builds, with a model id resembling `gpt-image/1.5-text-to-image` and an `input` shape using `prompt` + `aspect_ratio` + `quality` (e.g. `"high"`) rather than nano-banana's `resolution` tiers; or (b) a separate, older dedicated endpoint (`POST https://api.kie.ai/api/v1/gpt4o-image/generate`) with a materially different request/response shape (`size` as the aspect-ratio field, `nVariants`, a `{code,msg,data}` wrapper, `successFlag` instead of `state`). **Pre-Implementation step for this phase: confirm which path is current/correct against a live account before writing `kie-client.ts`** — prefer (a), the marketplace path, since it requires zero architectural change beyond the `model` string and `input` field names; only fall back to (b) if (a) doesn't actually support this model, which would need a second, differently-shaped client function. Cost/latency assumptions in this phase's Risk Assessment were researched against nano-banana pricing (~$0.02/image) — GPT-Image-1 pricing via Kie is unconfirmed and likely higher; re-check before assuming the 20-topic-batch cost estimate still holds.

## Key Insights
- **Templates are code constants; the LLM only supplies placeholder values.** `image-prompt-templates.ts` holds the 5 prompt strings from `image_ad_prompt_generator.md` **verbatim** with `[HEADLINE]`, `[TOPIC VISUAL ELEMENT]`, `[TOPIC SCENE]`, `[COLOR]` markers. We ask the model for a strict JSON object of fills, then substitute in TypeScript. Asking the model to author whole prompts would let the fixed ruleset (no logos, no photorealism, headline+CTA only, 1:1, warm palette) drift silently — this is the whole point of the file being "fixed".
- **Two OpenAI calls, not one** (research §2): call A = 5 style fills, call B = ad copy + countries. They map to two independent regenerate actions and keep each schema shallow.
- **`afs_creatives` is the job table.** Each row carries `kie_task_id` + `status`. No separate queue table, no webhook (see above).
- **[Red Team Fix] Reconcile-on-poll is the sole completion path, not a fallback.** Every `GET /batches/{id}` call reconciles rows in `'submitted'` by calling Kie `recordInfo` directly (our API key, not a trusted callback payload — forgery is a non-issue since there's no external caller to forge). No time-gating to `>90s` needed now that this is the only path, not a rare-case safety net — reconcile **every** `'submitted'` row on every poll, capped at 10/pass to bound latency.
- **[Red Team Fix] Reconcile claims rows atomically before calling Kie.** `UPDATE afs_creatives SET status='reconciling' WHERE id = $1 AND status='submitted'` (conditional, 0-rows-affected = someone else already claimed it) before the `recordInfo` call — prevents two concurrent polls (two open tabs) from double-fetching the same row and double-uploading to Storage.
- **Throttling:** Kie allows 20 createTask/10s and does not queue over-limit (429). Client submits 2 topics concurrently ⇒ ≤10 tasks per ~10s. Server adds a per-user 1.5s cooldown on `generate` (module-level Map, same best-effort pattern as `accounting-export:32` — best-effort/single-instance, not a hard guarantee; the client's own concurrency-2 cap is the load-bearing throttle).
- **[Red Team Fix] `generate` has an atomic status guard, not read-check-then-write.** `UPDATE afs_topics SET status='generating' WHERE id=$1 AND status IN ('draft','failed','ready','partial_failed') AND fb_campaign_id IS NULL RETURNING id` — 0 rows affected means either a concurrent generate is already running, or (closing Finding 3 from the other side) the topic already has a live campaign, in which case generate must reject with a clear error ("This topic has already been published — regeneration is disabled to avoid orphaning its live campaign") rather than silently deleting/replacing creatives out from under a published ad.
- **Refusals are first-class.** OpenAI may refuse health-adjacent copy. Detect `output[].content[].type === 'refusal'` and fail the topic with the refusal text, rather than parsing garbage.
- **Content-safety framing** is baked into call B's system prompt: informational/curiosity framing ("many people don't know…"), never direct-address diagnosis ("your condition"), no cure/guarantee/outcome claims, no before/after or personal-attribute implications. Applies to both the on-image headline and the FB body copy.

## Requirements
- `generateTopicContent(topic)` → `{ styles: 5 × {style_key, headline, topic_visual_element, topic_scene, color}, copy: {primary_text, ad_headline, countries[]} }`.
- Headline validation: 5-12 words (`image_ad_prompt_generator.md:14`), must contain a topic keyword; one automatic retry with a corrective message, then fail the topic.
- Country codes validated against an ISO-3166-1 alpha-2 constant; unknown codes dropped with a warning; empty → default `['US']`.
- Kie submit + reconcile-on-poll (sole completion path) + Storage rehost with dimension validation.

## Architecture

```
POST /api/afs-niche-testing/batches            → { batch, topics[] }  (≤20 topics, https URLs only)
POST /api/afs-niche-testing/topics/{id}/generate     [one topic per invocation]
   guard: cooldown 1.5s/user → atomic UPDATE status='generating' WHERE status IN (draft,failed,ready,
          partial_failed) AND fb_campaign_id IS NULL RETURNING id → 0 rows: 409 (already generating,
          or already published — regeneration of a published topic is refused, not silently allowed)
   → delete previous afs_creatives rows
   OpenAI A + B (Promise.all) → validate → 5 afs_creatives rows (prompt + headline, status='pending')
   for each: Kie createTask{ model: KIE_MODEL (gpt-image/1.5-text-to-image — verify exact id/shape first,
             see Overview), input:{prompt, aspect_ratio:'1:1', quality:'high'} — field names pending
             live-account confirmation, output_format:'png' if supported }
             → status='submitted', kie_task_id, submitted_at        (returns in ~5-10s)
             [Red Team Fix: no callBackUrl — webhook cut, reconcile-on-poll is the only completion path]

GET /api/afs-niche-testing/batches/{id}
   reconcile: rows in 'submitted' (ALL of them, not time-gated — this is the sole completion path)
              → atomic claim: UPDATE status='reconciling' WHERE status='submitted' RETURNING id
                (0 rows = already claimed by a concurrent poll, skip)
              → recordInfo → state:'success' ? fetch(resultUrls[0]) : mark failed(failMsg)
              → rehostKieImage: fetch bytes → validate content-type + size + WIDTH/HEIGHT (≥600×600) →
                storage.upload(`afs/{user}/{batch}/{topic}/{creative_id}-{style}.png`, bytes, {upsert:true})
              → status='succeeded' + storage_path, or 'failed' + error  (cap 10 rows/pass;
                >15min still unfinished → status='failed', 'generation timed out')
   → { batch, topics[], creatives[] with 1h signed URLs }
   → topic.status='ready' when ≥1 creative succeeded and none pending/submitted/reconciling
```

## Related Code Files
**Create:** `lib/ai/openai-client.ts`, `lib/ai/image-prompt-templates.ts`, `lib/ai/afs-content.ts`, `lib/kie/kie-client.ts`, `lib/afs/storage.ts`, `lib/afs/generation.ts`, `lib/afs/reconcile.ts`, `app/api/afs-niche-testing/batches/route.ts`, `app/api/afs-niche-testing/batches/[batchId]/route.ts`, `app/api/afs-niche-testing/topics/[topicId]/generate/route.ts`

**[Red Team Fix]** No `kie-callback` route (webhook cut — see Overview).

## Implementation Steps
1. `lib/ai/openai-client.ts` (~70 lines) — `POST https://api.openai.com/v1/responses`, `{model, input, text:{format:{type:'json_schema', name, schema, strict:true}}}`; parse refusal; 30s `AbortSignal.timeout`; one retry on 429/5xx; throw `Error('OpenAI: <message>')`.
2. `lib/ai/image-prompt-templates.ts` (~90 lines) — `STYLE_TEMPLATES: Record<AfsStyleKey, {label, template, placeholders[]}>` transcribed verbatim from `image_ad_prompt_generator.md`, plus `GLOBAL_RULES` (lines 9-17) appended to call A's system prompt, plus `fillTemplate(styleKey, fills)` that replaces markers and **throws if any `[MARKER]` remains**.
3. `lib/ai/afs-content.ts` (~120 lines) — call A schema (5 required style objects, all 4 fields required per strict mode; unused fields ignored per style), call B schema `{primary_text, ad_headline, countries: string[]}`; headline + country validation; the safety-framing system prompt; one corrective retry.
4. `lib/kie/kie-client.ts` (~60 lines) — `createTask(prompt)` → `taskId` (no callback URL param); `getTaskResult(taskId)` → `{state, resultUrls, failMsg}` parsing `JSON.parse(resultJson)`; Bearer auth; explicit 429 → `Error('Kie rate limit — retry shortly')`. **[Validation Session 1]** Model is `KIE_MODEL` (GPT-Image-1 via Kie, not nano-banana) — confirm the exact model id and `input` field names (`quality` vs `resolution`) against a live `docs.kie.ai` account/response before finalizing this file; if the marketplace `jobs/createTask` path turns out not to support GPT-Image-1, this file's shape changes to target the dedicated `POST /api/v1/gpt4o-image/generate` endpoint instead (different field names: `size`, `nVariants`; different response wrapper: `{code,msg,data:{taskId}}` and `successFlag` instead of `state`) — flag this to whoever implements Phase 04 as a go/no-go check before writing the rest of the file.
5. `lib/afs/storage.ts` — `rehostKieImage(userId, batchId, topicId, creativeId, styleKey, url)`: `fetch` (15s timeout) → assert `content-type` starts `image/`, size 10KB-8MB, **and [Red Team Fix] parse actual pixel width/height from the downloaded bytes (e.g. via a lightweight PNG/JPEG header read) — reject <600×600 with a clear "image too small, regenerate" error before uploading**; path keyed by `creativeId` (not just topic+style) to eliminate regenerate-race collisions; `service.storage.from('afs-creatives').upload(path, bytes, {contentType, upsert:true})`; `signUrl(path)` → 1h signed URL.
6. `lib/afs/generation.ts` — the per-topic pipeline with the atomic status-transition guard; `lib/afs/reconcile.ts` — the sole-completion-path sweep, with the atomic per-row claim before each `recordInfo` call.
7. Routes per the architecture block. All: `auth.getUser()` → `requireRole(['admin','leader'])` → ownership check. No unauthenticated routes in this phase (webhook cut).
8. `export const maxDuration = 60` on `generate`.
9. Typecheck, lint, build.

## Todo List
- [ ] Confirm `OPENAI_MODEL` availability (fallback `gpt-5.4-nano`) with one live call [BLOCKED: requires OpenAI account]
- [ ] **[Validation Session 1]** Confirm Kie's GPT-Image-1 exact model id + input shape (marketplace `jobs/createTask` path preferred; fall back to the dedicated `gpt4o-image/generate` endpoint only if the marketplace path doesn't support it) — go/no-go check before writing `kie-client.ts` [PRE-IMPLEMENTATION STEP — BLOCKED: requires live Kie account verification]
- [ ] Confirm Kie GPT-Image-1 1:1 output dimensions with one live call (informs the ≥600×600 runtime check, not just a one-time sign-off) — also re-confirm per-image cost/latency now that the model changed from nano-banana [BLOCKED: requires Kie account]
- [x] `openai-client.ts` + refusal handling
- [x] `image-prompt-templates.ts` transcribed verbatim + `fillTemplate` leftover-marker guard
- [x] `afs-content.ts` (2 calls, validation, safety framing, 1 retry)
- [x] `kie-client.ts` (no callback URL param), `storage.ts` (incl. dimension validation, SSRF hardening), `generation.ts` (atomic status guard), `reconcile.ts` (atomic per-row claim, timeout logic per code review)
- [x] 3 routes (batches, batches/[id], generate) — no callback route
- [ ] Test: reconcile path completes a topic within ~2 min with no webhook involved at all [BLOCKED: requires live testing]
- [ ] Test: two concurrent polls on the same stuck batch never double-upload the same creative (atomic claim holds) [BLOCKED: requires live testing]
- [ ] Test: `generate` on an already-published topic is rejected, not silently regenerated [BLOCKED: requires live testing]
- [ ] Test: undersized Kie output is caught by the dimension check and fails that creative with a clear error, not a later publish-time surprise [BLOCKED: requires live testing]
- [x] Typecheck + lint + build

## Success Criteria
- One topic → 5 rows `succeeded`, 5 objects in `afs-creatives`, images visibly match their style (notes-app / pixel / editorial / craft / bold type), headline+CTA baked in, no logos, 1:1, each ≥600×600 (enforced, not just eyeballed).
- Prompts stored in `afs_creatives.image_prompt` contain no unresolved `[MARKER]`.
- Copy for a health-adjacent topic uses informational framing; a refusal surfaces as a topic error naming the refusal.
- A topic completes via reconcile-on-poll alone within ~2 min (this is the only path, not a fallback being tested against a primary).
- 20-topic batch at client concurrency 2 never triggers a Kie 429.
- Two tabs polling the same batch concurrently never produce duplicate Storage uploads or duplicate Kie `recordInfo` calls for the same row.
- Attempting to regenerate a topic that already has `fb_campaign_id` set is rejected with a clear error, not silently allowed.

## Risk Assessment
| Risk | L | I | Mitigation |
|------|---|---|-----------|
| Reconcile poll stops (user closes tab and never returns) before a batch finishes | Med | Med | Accepted — "Resume generation" (Phase 05) re-drives it next time the batch is opened; no background cron in v1 (YAGNI) |
| Kie result URL expires before download (24h vs 14d conflict) | Low | High | Download immediately inside reconcile; never store a Kie URL |
| Kie 429 on burst | Med | Med | Client concurrency 2 + 1.5s/user server cooldown; 429 → per-creative failure, retry via regenerate |
| OpenAI refuses health topic | Med | Med | Refusal = first-class topic error with the model's reason; user rewrites the topic |
| LLM writes a 20-word headline → text overflows the image | Med | Med | 5-12 word validation + one corrective retry, then fail |
| Hallucinated country codes | Med | Low | ISO allowlist filter + `['US']` fallback + warning |
| Model emits prompt text that violates the global rules (logos/photoreal) | Low | Med | Model only supplies fills; rules live in the code-resident template |
| Storage cost growth (100 PNG/batch) | Low | Low | Cascade delete on batch removal; no retention job in v1 (YAGNI) |
| `generate` invocation times out on a slow OpenAI call | Low | Med | `maxDuration=60`, 30s per-call abort, topic left `generating` and retryable |
| **[Red Team Fix]** Undersized Kie output (Facebook needs ≥600×600) discovered only at publish time, after generation + human review cost is sunk | Med | Med | Dimension check in `rehostKieImage` fails the creative immediately with a clear "too small, regenerate" error |
| **[Red Team Fix]** Two concurrent polls both reconcile the same stuck row → duplicate Kie calls / Storage writes | Low | Low | Atomic conditional-UPDATE claim before each `recordInfo` call |
| **[Red Team Fix]** `generate` (or "Regenerate topic") called on an already-published topic → creatives silently replaced while the live campaign still shows the old (now-deleted) images | Med | High | Atomic status guard rejects `generate` when `fb_campaign_id IS NOT NULL`, closing this from the generation side (Phase 03's `publish-step.ts` closes it from the publish side) |

## Security Considerations
- No unauthenticated routes in this phase — the webhook (and its public-surface risk) is cut entirely; every route requires session + role + ownership.
- `OPENAI_API_KEY` / `KIE_API_KEY` are server-only; both clients live under `lib/` and are never imported from a `'use client'` file.
- Storage bucket is private; the browser only ever receives short-lived signed URLs.
- `target_url` validated `https:` at intake (Phase 05) — it becomes both an ad destination and a prompt input.

## Next Steps
- Phase 05 (UI) consumes `batches`, `generate`, `batches/{id}`.
