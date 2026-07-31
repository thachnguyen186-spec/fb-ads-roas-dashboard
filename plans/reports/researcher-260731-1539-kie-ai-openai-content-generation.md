# Research: Kie AI + OpenAI content-generation pipeline for topic-based ad creatives

Date: 2026-07-31. All facts below verified via WebFetch/WebSearch against primary sources (docs.kie.ai, developers.openai.com, vercel.com/docs, openai.com/policies) dated 2026, not training-data assumptions.

## 1. Kie AI API (docs.kie.ai)

**createTask** — `POST https://api.kie.ai/api/v1/jobs/createTask`, `Authorization: Bearer <API_KEY>`.
Body:
```json
{
  "model": "google/nano-banana",           // or "nano-banana-pro", "nano-banana-2"
  "callBackUrl": "https://yourapp.com/api/kie-callback",  // optional, recommended
  "input": {
    "prompt": "string, max 5000 chars (10000 for pro)",
    "aspect_ratio": "1:1",                  // default 1:1 — satisfies square-image need
    "output_format": "png",                 // or "jpeg/jpg"
    "resolution": "1K"                      // pro/2 variants only: 1K|2K|4K
  }
}
```
`image_size` param is deprecated, replaced by `aspect_ratio`. **No exact "1080x1080" pixel selector exists** — you get `aspect_ratio: "1:1"` and (for pro) a `resolution` tier; actual output pixel dims aren't independently documented — verify against a live response before assuming exact 1080px. [docs.kie.ai/market/google/nano-banana](https://docs.kie.ai/market/google/nano-banana), [docs.kie.ai/market/google/pro-image-to-image](https://docs.kie.ai/market/google/pro-image-to-image)

**recordInfo / get-task-detail** — response `data`: `{taskId, model, state, resultJson, failCode, failMsg, costTime, completeTime, createTime, updateTime, progress, creditsConsumed}`. `state` ∈ `waiting|queuing|generating|success|fail`. Final image: `JSON.parse(resultJson).resultUrls[0]`. [docs.kie.ai/market/common/get-task-detail](https://docs.kie.ai/market/common/get-task-detail)

**Webhooks**: `callBackUrl` in createTask → Kie POSTs status+resultUrls to it on completion — **documented as the recommended production pattern over polling**, directly relevant for Vercel functions. Fallback if no webhook: poll with exponential backoff, ~2-3s start, give up after 10-15 min.

**Pricing** (third-party sources, not independently confirmed on kie.ai/pricing directly — verify at signup): nano-banana ~$0.02/image; nano-banana-2 from $0.04; nano-banana-pro $0.09 (1K/2K) / $0.12 (4K). [technology.org](https://www.technology.org/2025/11/24/the-real-cost-of-nano-banana-pro-api-why-developers-choose-kie-ai-for-ai-image-generation/), [aifreeapi.com](https://www.aifreeapi.com/en/posts/nano-banana-pro-cost)

**Rate limits**: up to 20 new generation requests/10s per account; ~100+ concurrent tasks; over-limit → HTTP 429, request never queues. **Directly relevant**: 5 images/topic × several topics submitted at once can hit this if you fire all at once — need client-side throttling/queue.

**Retention — CONFLICTING, treat as ephemeral either way**: general docs state "generated media stored for 14 days then auto-deleted"; a separate synthesis of the task-detail page stated result URLs "typically expire after 24 hours." Do not trust either number as authoritative without a live test — **the actionable conclusion is identical regardless: not permanent, must be copied out immediately.**

## 2. OpenAI structured output (developers.openai.com, 2026)

**Mechanism**: `response_format: {type:"json_schema"}` is legacy naming; current (2026) Responses API uses `text: {format: {type:"json_schema", name, schema, strict:true}}`. Strict mode is now the sole recommended path — "JSON Mode is legacy" per 2026 guidance. Schema rules: every property must be in `required`; optional = `anyOf` with `null`; max 5 levels of nesting; `pattern`/`minLength`/`format` keywords not enforced by the model itself. [developers.openai.com/api/docs/guides/structured-outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

**One call vs split**: your payload (5 filled prompt objects + ad copy + country list) nests only 2-3 levels deep — well within the 5-level limit, so a **single combined call is technically fine**. Recommend **splitting into 2 calls** anyway: (a) 5 image-prompt fills, (b) ad copy + targeting — because these map to two independent "regenerate" actions in a review UI (user may want to reroll ad copy without re-rolling image prompts), and keeps each schema/prompt simpler to iterate. Cost difference is negligible (both calls are short, <1k output tokens combined).

**Model recommendation**: **GPT-5.6 Luna** (released 2026-07-09, confirmed via [CNBC](https://www.cnbc.com/2026/07/08/openai-expanding-gpt-5point6-ai-model-release-ending-government-limits.html), [Engadget](https://www.engadget.com/2210308/openai-rolls-out-gpt5-6-july-9/), [Wikipedia](https://en.wikipedia.org/wiki/GPT-5.6)) — $0.20/1M input, $1.20/1M output, 1.05M context, Structured Outputs + function calling supported, explicitly positioned for "cost-sensitive, high-volume workloads." [developers.openai.com/api/docs/models/gpt-5.6-luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna). This is a materially newer/cheaper option than GPT-4.1-mini ($0.40/$1.60) or GPT-5.4-nano ($0.20/$1.25) — **do not default to gpt-4.1-mini from training data, it's stale.** Do not use Terra/Sol (full GPT-5.6 tiers) — overkill for short templated copy.

**Content-policy risk**: OpenAI usage policies prohibit "tailored advice that requires a license (medical/legal) without licensed professional involvement" and ban deceptive/unsubstantiated health claims generally. This is a real risk for an "Enlarged Prostate"-style AFS niche: naming the condition/symptom is fine, but copy implying diagnosis, cure, or guaranteed treatment outcomes risks refusal or account-level policy action. Note OpenAI's separate "Ad policies" page (excludes healthcare from ads shown *inside ChatGPT*) is a different policy surface and **does not directly apply** here since you're not buying inventory on OpenAI's own ad platform — but the general usage-policy health-claims restriction still applies to API-generated text. **Recommend**: prompt for symptom-awareness/informational framing, add a human-review checkpoint before publishing, and handle model refusals as first-class errors (per 2026 structured-output best practice) rather than assuming success.

## 3. Image hosting bridge

Kie URLs are not durable (see §1 retention conflict). Correction to an earlier low-confidence WebSearch hit: `POST /act_{id}/adimages` does **NOT** accept a remote URL param — confirmed against `developers.facebook.com/docs/marketing-api/reference/ad-image/` it only accepts `bytes` (base64/multipart) or `copy_from` (cross-account hash copy). (Separately, `object_story_spec.link_data.picture` on `/adcreatives` *does* accept an external URL FB will fetch itself — but that's a different, less controllable code path with no stable `image_hash`; not recommended here.) This makes the download step **mandatory, not optional** — you cannot hand Facebook a Kie URL directly under any option.

**Recommendation**: immediately after Kie reports `state: success`, server-side `fetch()` the `resultUrls[0]` bytes, (1) upload to a Supabase Storage public bucket for the review UI / durable record, and (2) pass those same bytes to `/adimages` as `bytes` (base64) when the ad is actually created. This is the standard "don't depend on a third-party ephemeral CDN for a business asset" pattern, and is also the only path Facebook's API actually supports.

## 4. Cost/latency estimate

Per topic: 1-2 OpenAI calls (~1-3s each, <$0.01 total) + 5 parallel Kie image jobs (~10-20s nano-banana, ~20-50s pro/2K) → wall time ≈15-60s per topic if the 5 jobs run concurrently, dominated by the slowest job. For a batch of 10-20 topics (50-100 images), naive full-parallel submission will hit Kie's 20-requests/10s cap — needs client-side queueing/throttling. Realistic batch wall time: **2-5+ minutes**, and per-image latency is inherently variable (queue depth on Kie's side, not something you control).

This **exceeds** a safe synchronous request/response even on Vercel Pro with Fluid Compute (default 300s max, up to 800s configurable) once you account for queueing/throttling overhead across a whole batch — and is definitely incompatible with Hobby-tier defaults. [vercel.com/docs/functions/limitations](https://vercel.com/docs/functions/limitations) (fetched 2026-07-01 version).

**Recommend a job-queue pattern, not sync request/response**: persist a per-topic/per-image row in Supabase, submit Kie createTask calls through a rate-limit-aware queue (respecting 20/10s), use Kie's `callBackUrl` webhook (not polling) to update those rows on completion, and drive the review UI off your own DB (Supabase Realtime subscription or simple polling of your own lightweight status endpoint) rather than blocking a serverless function on the whole batch.

## Recommended architecture (summary)

Per topic: 2 OpenAI Responses API calls to GPT-5.6 Luna with `strict:true` json_schema (one for the 5 filled image prompts, one for ad copy + country targeting), then 5 concurrent Kie AI `createTask` calls (model `nano-banana` or `nano-banana-2` for cost, `aspect_ratio:"1:1"`) submitted through a rate-limited queue respecting Kie's 20-req/10s cap; use Kie's `callBackUrl` webhook (pointed at a Next.js API route) instead of polling to receive completion — this avoids long-running serverless invocations entirely. On webhook receipt, immediately download the Kie result URL's bytes and store them in Supabase Storage (never rely on Kie's URL past the initial fetch — and note Facebook's `/adimages` requires raw `bytes` anyway, it has no remote-URL option), update a Supabase job-status table, and drive the UI via Realtime/polling of your own status endpoint so a batch of 10-20 topics is a background job with progress, not a blocking synchronous call.

## Unresolved questions / risks

- Exact output pixel dimensions for `aspect_ratio:"1:1"` unconfirmed — need one live test call to confirm it's actually 1080x1080-equivalent (or close enough for FB's image-ad requirements).
- Kie retention window conflicting (14 days vs 24h in different doc sources) — irrelevant to the recommended architecture (we copy out immediately) but worth a direct account-rep confirmation if audit requirements matter.
- No official kie.ai/pricing page fetch succeeded (403/blocked); prices above are third-party — confirm exact current per-image cost in your Kie dashboard before budgeting.
- Whether your OpenAI account/tier has GPT-5.6 Luna access yet (rolled out 2026-07-09, very recent) — confirm via `developers.openai.com` model list under your API key before committing; GPT-5.4-nano is an equivalent-price fallback if not yet available.
- Did not research Facebook's own health/medical ad-content policy restrictions (separate from OpenAI's) — a real gap given the "Enlarged Prostate" example; Meta has its own strict special-ad-category and health-claim rules that could block ad approval independent of OpenAI's output quality. Recommend a follow-up research pass specifically on Meta's health-content ad policy before launch.
