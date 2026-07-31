---
name: fb-marketing-api-ad-creation
type: research
date: 2026-07-31
---

# Meta Marketing API — From-Scratch Ad Creation Reference

Current Graph/Marketing API version (checked 2026-07-31): **v25.0** (released 2026-02-18, expires 2028-07-29). Codebase pins **v21.0** (`lib/facebook/fb-client.ts`), released 2024-10-02, **expires 2027-01-21** — still valid, no forced migration, but v21 predates the v22.0 (2025-01-21) Advantage+ creative opt-out rework (item 4). Recommend bumping `FB_API_BASE` to v22.0+ for the new write endpoints (one-line change, existing endpoints are unaffected). [Version table](https://developers.facebook.com/docs/graph-api/changelog/versions/).

Existing app only instructs users to mint tokens with `ads_management` + `ads_read` (`app/settings/page.tsx:136-137`) — no `pages_show_list`/`business_management`. This is a gap for item 6.

## 1. Campaign — `POST /act_{id}/campaigns`
- `objective`: **`OUTCOME_TRAFFIC`** is current/correct (ODAX enum family: OUTCOME_AWARENESS/TRAFFIC/ENGAGEMENT/LEADS/APP_PROMOTION/SALES). Legacy `LINK_CLICKS` objective is deprecated since v17.0 and rejected on new campaigns.
- `special_ad_categories`: **mandatory since v7.0**, array type. Send `[]` (empty array) when not a special category; docs text also lists `NONE` inside the enum but current field is plural/array-shaped — empty array is the safe form. **Verify empirically** (doc text was inconsistent — see unresolved Qs).
- `status`: only `ACTIVE` or `PAUSED` are valid at creation (new ads inside then go to `PENDING_REVIEW` regardless).
- `buying_type`: defaults to `AUCTION` (only alternative is `RESERVED`, irrelevant here).
- Source: [ad-campaign-group reference](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/) (fetched 2026-07-31).

## 2. AdSet — `POST /act_{id}/adsets`
- `targeting.geo_locations.countries`: array of ISO country codes, e.g. `["US"]`. `age_min`/`age_max`/`genders` optional, omit for broad targeting.
- `optimization_goal` valid for OUTCOME_TRAFFIC: `LINK_CLICKS`, `LANDING_PAGE_VIEWS`, `IMPRESSIONS`, `REACH`. For an arbitrage/CTR play, `LINK_CLICKS` is the standard choice (cheapest volume); `LANDING_PAGE_VIEWS` filters for actual page loads at higher CPC.
- `billing_event`: `IMPRESSIONS` is the universal-safe default. When `optimization_goal=LINK_CLICKS`, `billing_event` may be `IMPRESSIONS` **or** `LINK_CLICKS` (CPC); `LANDING_PAGE_VIEWS` optimization requires `billing_event=IMPRESSIONS`.
- `daily_budget`/`lifetime_budget`: int64, **minor currency unit** (cents for USD) — matches existing `campaign-actions.ts` convention (`amount*100` for non-VND) already in codebase. `lifetime_budget` requires `end_time`.
- `bid_strategy`: default/simplest = `LOWEST_COST_WITHOUT_CAP` (no `bid_amount` needed). `LOWEST_COST_WITH_BID_CAP`/`COST_CAP` require `bid_amount`.
- `promoted_object`/pixel: **NOT mandatory** for `LINK_CLICKS` traffic optimization — pixel is purely an optional signal/tracking object here (`{pixel_id, custom_event_type}`), unlike conversion campaigns where it's required. Since the destination is an external AdSense-for-Search page you don't control events on, pixel is optional signal only — safe to omit or pass through for click tracking.
- `destination_type`: `WEBSITE` for link-click-to-external-URL ads.
- `start_time`: optional (defaults immediate); required only if scheduling ahead or using `lifetime_budget` (then `end_time` also required).
- `status`: `ACTIVE`/`PAUSED` only at creation.
- Source: [ad-account/adsets reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account/adsets/) (fetched 2026-07-31). Note: could not retrieve Meta's authoritative ODAX objective↔optimization_goal↔destination_type mapping table (page 404s under WebFetch, likely JS-rendered widget) — above is cross-referenced from this reference page + community sources, **not confirmed against the primary ODAX table**. Test with one manual campaign first.

## 3. Ad Image Upload — `POST /act_{id}/adimages`
- Accepts **only** `bytes` (base64 string) or `copy_from` (`{source_account_id, hash}`). **No remote-URL-fetch parameter exists on this endpoint** — you must download the generated image server-side and base64-encode it before POST.
- Response: map keyed by filename → `{hash, url, url_128, url_256, height, width, name}`. Use `hash` as `image_hash` in creatives.
- **Shortcut worth knowing**: `object_story_spec.link_data.picture` (see #4) accepts a **direct external image URL** — Facebook fetches and caches it into the account's image library at creative-creation time, bypassing `/adimages` entirely. Trade-off: adds a live dependency on your image-gen host being reachable by Facebook at creative-creation time, and no `image_hash` to reuse/dedupe later. For durability (creatives get re-used/edited later, need stable hashes for QA), prefer the explicit `/adimages` bytes-upload path over the `picture` URL shortcut.
- Source: [ad-account/adimages reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account/adimages/), [ad-creative-link-data reference](https://developers.facebook.com/docs/marketing-api/reference/ad-creative-link-data) (fetched 2026-07-31).

## 4. Ad Creative — `POST /act_{id}/adcreatives`
- `object_story_spec.page_id`: **required** — confirms a Page selection is mandatory.
- `object_story_spec.link_data`: `link` (must match CTA link), `message` (body text), `name` (headline — but your images already bake in the headline, so this becomes secondary/duplicate copy shown above the image), `description`, `image_hash` (or `picture` URL per #3), `call_to_action: {type: "LEARN_MORE", value: {link}}`.
- Advantage+ creative enhancements: as of **MAPI v22.0 (2025-01-21)** the old single `enable_standard_enhancements` boolean bundle is deprecated in favor of **per-feature opt-out** via a top-level (sibling to `object_story_spec`) field:
```json
"degrees_of_freedom_spec": {
  "creative_features_spec": {
    "standard_enhancements": { "enroll_status": "OPT_OUT" }
  }
}
```
  Individual sub-features (`image_template`, `image_touchups`, `text_optimizations`, `inline_comment` for image ads) are also independently settable. Since your images have headline+CTA baked in and must render unmodified, **opt out explicitly** — do not rely on defaults. This is the main reason to bump past v21.0.
- Source: [ad-creative reference](https://developers.facebook.com/docs/marketing-api/reference/ad-creative), [standard-enhancements doc](https://developers.facebook.com/docs/marketing-api/advantage-catalog-ads/standard-enhancements/) (fetched 2026-07-31).

## 5. Ad — `POST /act_{id}/ads`
- Required: `name`, `adset_id`, `creative: {creative_id}`, `status` (`ACTIVE`/`PAUSED`). New ads always enter `PENDING_REVIEW` post-creation irrespective of the status field.
- Source: [adgroup reference](https://developers.facebook.com/docs/marketing-api/reference/adgroup) (fetched 2026-07-31, example payload shown against v25.0).

## 6. Pages / Pixels listing + permissions
- `GET /me/accounts` → `data[]`: `id`, `name`, `access_token` (page token), `category`, `tasks[]`. Requires `pages_show_list` (error-code hints also reference `pages_read_engagement`). **Not currently requested** by this app's token setup instructions — must add scope.
- `GET /act_{id}/adspixels` → `data[]`: `id`, `name`, `code`, `creation_time`, `last_fired_time`, `owner_business`, etc. Governed as an ad-account sub-resource — no extra scope beyond `ads_management`/`ads_read` found in docs (not explicitly confirmed either way).
- `ads_management` requires **App Review / Advanced Access** once the app operates on ad accounts outside its own Business Manager. Existing `duplicateCampaignSameAccount` already performs writes successfully with just `ads_management` on a manually-pasted token — implies the current FB app is either already reviewed or only ever targets owned/internal ad accounts. Confirm this before onboarding external workspaces.
- Sources: [user/accounts reference](https://developers.facebook.com/docs/graph-api/reference/user/accounts/), [ad-account/adspixels reference](https://developers.facebook.com/docs/marketing-api/reference/ads-pixel), [ads_management permission](https://developers.facebook.com/docs/permissions/reference/ads_management) (fetched 2026-07-31).

## 7. Batch semantics & failure handling
- Graph API supports a true multi-request batch: `POST /` with a `batch` JSON array, **max 50 sub-requests per batch**. Supports intra-batch dependency chaining via `{result=<name>:$.id}` placeholders, so campaign→adset→creative→ad for one topic fits in a single batch call.
- **No transactional rollback.** Each sub-request commits independently; a batch is not atomic — "other requests in the batch still complete successfully" even if one fails.
- **Realistic failure mode**: campaign + adset succeed, then one of 5 ad/creative creations fails (e.g. bad image, policy rejection). Caller MUST inspect each sub-response's HTTP status individually and, on any failure past adset creation, `PATCH` the topic's campaign to `status=PAUSED` (cheap, matches existing `pauseCampaign` helper) rather than leaving an orphaned live campaign — do not attempt silent retry without user review.
- Source: [Graph API batch requests](https://developers.facebook.com/docs/graph-api/batch-requests) (fetched 2026-07-31).

## 8. Rate limits
- Business Use Case (BUC) rate limiting, scoped per app+ad-account. For `ads_management`: **(300/hr on Dev Tier, or 100,000/hr on Marketing API Standard/Full Access) + 40 × number of currently active ads**.
- Usage surfaced via response header (`X-Business-Use-Case-Usage`): `call_count`/`total_cputime`/`total_time` as % of budget. Throttle client-side at ~80%; back off on error codes 17/80000/80003/80004 (too many calls) with exponential backoff (60s→double→cap ~16min).
- For the stated scale (10-20 topics × 5 creatives ≈ 50-100 image uploads + 10-20 campaigns/adsets + up to 100 ads/creatives ≈ 250-350 write calls total), even the **Dev Tier floor (300/hr)** is workable if paced (e.g., one 50-request batch every few seconds) rather than fired as one instantaneous burst, since a fresh Dev Tier account has no "active ads" credit yet to pad the 300 base.
- Source: [Marketing API rate limiting](https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/) (fetched 2026-07-31).

## Recommended object model
**One campaign + one adset per topic, then 5 separate ads (1 ad = 1 adcreative = 1 image) inside that adset**, all pointing at the same target URL. Rationale: matches the "review all 5 creatives added per topic" UI requirement 1:1 (each ad = one reviewable/pausable unit), keeps every object-creation call a simple independent POST consistent with the existing `fbPostForm`/`fbPatch` precedent (no new SDK/pattern needed — KISS/DRY), and lets Facebook's ad-set budget auto-optimize spend across the 5 image variants without needing Dynamic Creative (`asset_feed_spec`, `dynamic_creative=true`) — a materially more complex, less individually-reviewable creative type not worth the complexity for a 5-variant test. Do NOT use carousel (`child_attachments`) — that's for multi-card single ads, not variation testing.

Per topic: 1 campaign + 1 adset + 5×(image upload + creative + ad) ≈ 17 write calls, submittable as one Graph batch (under the 50-limit) with per-sub-response inspection and pause-on-partial-failure per item 7.

## Unresolved questions
1. Does the manually-pasted user token (current onboarding: `ads_management`+`ads_read` only) need `pages_show_list` added, and does the underlying FB app have Advanced Access/App Review clearance for ad accounts outside its own Business Manager? Blocks item 6 in production.
2. `special_ad_categories`: confirm empirically whether `[]` or `["NONE"]` is accepted — official doc text was self-contradictory on this.
3. Could not retrieve Meta's primary ODAX objective↔optimization_goal↔billing_event↔destination_type mapping table directly (multiple 404s, likely JS-rendered doc widget not reachable via WebFetch) — items 1-2's enum combinations are cross-referenced from secondary reference pages, not the authoritative table. Recommend one manual test campaign in Ads Manager UI to confirm before building the generator against these values.
4. Whether `degrees_of_freedom_spec.creative_features_spec` opt-out (v22.0+ syntax) also works unchanged on the codebase's current v21.0 pin, or whether the new write endpoints truly need the base URL bumped.
5. Whether `/act_{id}/adspixels` needs any scope beyond `ads_management`/`ads_read` — not explicitly stated in fetched docs, only inferred by omission.

**Limitations**: Several official doc pages returned HTTP 404 under WebFetch (interactive/JS-rendered reference widgets) or lacked permission-scope specifics; those gaps were filled via WebSearch summaries of secondary sources (blogs, community threads) which are lower-confidence than direct doc quotes — flagged inline above wherever this applies. Did not research: App Review submission process/timeline, webhook-based ad-review-status callbacks, or AdSense-for-Search policy compliance risk on the destination-URL side (out of scope for this API-mechanics request).
