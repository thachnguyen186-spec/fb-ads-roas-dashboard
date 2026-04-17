# Facebook Marketing API v21 Cross-Account Campaign Replication Research

**Date:** 2026-04-15  
**Scope:** Practical constraints for programmatic campaign cloning across ad accounts

---

## 1. Ad Sets: Fetching & Safe Fields for Reuse

**GET `/act_{account_id}/adsets?campaign_id={id}`**

Common returnable fields: `id`, `name`, `campaign_id`, `targeting`, `status`, `optimization_goal`, `billing_event`, `daily_budget`, `lifetime_budget`, `start_time`, `end_time`, `promoted_object`.

**Safe to re-use cross-account:**
- `name`, `optimization_goal`, `billing_event`, `daily_budget`, `lifetime_budget`, `start_time`, `end_time`, `status`
- `targeting` — **WITH CAVEATS** (see #8)

**Unsafe/account-specific:**
- `campaign_id` (must map to dest campaign)
- `promoted_object` — if references `pixel_id`, `application_id`, or `custom_audiences` (see #9)

---

## 2. Ads & Creative Field Structure

**GET `/act_{account_id}/ads?campaign_id={id}&fields=name,creative,status,...`**

Returns `creative` object (nested). Full structure includes:
- `creative.id`, `creative.object_story_spec`, `creative.link_data`, `creative.title`, `creative.body`, `creative.image_hash`, `creative.image_url`

For video ads: `creative.video_id`, `creative.video_data`  
For carousel: `creative.asset_feed_spec`

---

## 3. Creative Details: Fetchable Fields

**GET `/{creative_id}?fields=body,title,image_url,image_hash,call_to_action,link_url,object_story_spec`**

Available fields by ad type:

| Type | Key Fields | Notes |
|------|-----------|-------|
| Image Ad | `body`, `title`, `image_hash`, `image_url`, `link_url`, `call_to_action_type` | Both `image_hash` and `image_url` returned; see #6 |
| Video Ad | `video_id`, `video_data`, `title`, `body`, `link_url` | `video_id` account-specific |
| Carousel | `asset_feed_spec` (array of assets) | Each asset has `image_hash` or `video_id` |
| Story Spec | `object_story_spec` | Contains nested page_id, link_data, video_data |

---

## 4. Cross-Account Image Reuse: URL vs Hash

**Problem:** `image_url` points to `fbcdn.net` CDN. Can we POST directly?

**Answer:** **NO** — `image_url` is read-only. Facebook serves cached URLs; they're not portable.

**Requirement:** Must use `image_hash` from source account's `AdImage` library, OR download+re-upload to dest account.

**Practical flow:**
```
Source: GET /creative_id → image_hash (e.g., "abc123xyz")
Dest: POST /act_{dest}/adimages with raw image file
     → Get new image_hash (e.g., "def456uvw")
Dest: POST /act_{dest}/adcreatives with new image_hash
```

**Constraint:** Image hashes are **account-specific**. Cannot reuse source hash in dest account.

---

## 5. Creating Ad Sets Cross-Account: Required Fields

**POST `/act_{dest}/adsets`**

| Field | Required | Notes |
|-------|----------|-------|
| `campaign_id` | Yes | Must be campaign in dest account |
| `name` | Yes | Up to 400 chars |
| `optimization_goal` | Yes | E.g., `LINK_CLICKS`, `APP_INSTALLS` |
| `billing_event` | Yes | E.g., `IMPRESSIONS`, `CLICKS`, `PURCHASE` |
| `targeting` | Yes* | *Unless using promoted_object with full spec |
| `promoted_object` | Conditional | Required for app/page/catalog campaigns |
| `daily_budget` or `lifetime_budget` | Yes | In cents (e.g., $100 = 10000) |
| `status` | No | Defaults to `PAUSED` |

---

## 6. Creating Ad Creatives Cross-Account

**POST `/act_{dest}/adcreatives`**

| Parameter | Behavior |
|-----------|----------|
| `image_url` | **Rejected** — Must use `image_hash` of image already uploaded to dest account |
| `image_hash` | **Required** for image ads. Must be hash from dest account's `/act_{dest}/adimages` |
| `object_story_spec` | Nested structure with `page_id`, `link_data` (contains `message`, `link`, `image_hash`) |
| `video_id` | Account-specific; cannot reuse source ID |

**Workflow:** Upload image → get hash → build creative with `object_story_spec` + `link_data` + `image_hash`.

---

## 7. Creating Ads Cross-Account

**POST `/act_{dest}/ads`**

| Field | Notes |
|-------|-------|
| `adset_id` | Must be adset in dest account |
| `creative` | Object with `creative_id` (from dest account) OR inline creative spec |
| `name` | Ad name (optional) |
| `status` | `ACTIVE` or `PAUSED` |

---

## 8. Custom Audience Targeting Conflict

**Problem:** Copy targeting with `custom_audiences: [id_from_source]` to dest account.

**Actual Behavior:**
- **Does NOT fail silently.** Returns validation error: `"Missing Target Audience Location: Your audience is missing a location. You can add a location or a Custom Audience."`
- Audience IDs are account-specific; source CA ID doesn't exist in dest account.
- Must be remapped: create CA in dest account (or reuse shared Business CA if accessible).

**Workaround:**
1. Check if CA is Business-level (shared): Query `GET /custom_audience_id/ad_accounts` — if shared across accounts, IDs should work.
2. If account-level: Must recreate CA in dest account before targeting.

**Targeting fallback:** If CA unavailable, provide `geo_locations` + `interests` + `behaviors` to avoid validation error.

---

## 9. App Campaign Specifics (OUTCOME_APP_PROMOTION)

**Required `promoted_object` fields:**
- `application_id` — **Account-agnostic** (global app ID). Portable.
- `object_store_url` — **Optional but common.** Platform-specific app store URL (portable).
- `custom_event_type` — If using pixel_id (see below).

**Account-specific conflict:**
- `pixel_id` — Tied to source account. Must be remapped/recreated in dest account.

**Error 1815437:** "Missing or Invalid Field in Promoted Objects: For optimization goal APP_INSTALLS, application_id needs to be valid."

**Cross-account fix:** Only port `application_id` + `object_store_url`; recreate pixel if needed.

---

## Key Takeaways

✓ **Portable:** Campaign name, optimization goal, billing, budget, app ID, geo/interest targeting  
✗ **Not portable:** Image hashes, video IDs, custom audience IDs, pixel IDs, promoted_object.page_id  
⚠ **Conditional:** Custom audiences (if Business-level shared, OK; if account-level, recreate)

**Simplest flow:** Fetch source → strip account-specific IDs → recreate images/audiences in dest → POST with new IDs.

---

## Unresolved Questions

1. Does Asset Library (`/act_{biz_id}/adimages` at business level) allow true cross-account image reuse, or is account isolation enforced at POST time?
2. Can `object_story_spec.page_id` be ported if page is shared biz asset, or must it be recreated in dest account context?
3. Does `promoted_object.pixel_id` error immediately on cross-account POST, or does it create a broken reference silently?

---

## Sources

- [Graph API Reference v25.0: Ad Set - Meta for Developers](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/)
- [Graph API Reference v25.0: Ad Creative - Meta for Developers](https://developers.facebook.com/docs/marketing-api/reference/ad-creative/)
- [Ad Set Promoted Object - Meta for Developers](https://developers.facebook.com/docs/marketing-api/reference/ad-promoted-object)
- [Facebook Business SDK - AdSet Creation](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adset.py)
- [Facebook Marketing API Sample Code](https://github.com/fbsamples/marketing-api-samples/blob/master/samples/samplecode/adcreation.py)
- [Ads Pixel Shared Accounts - Meta](https://developers.facebook.com/docs/marketing-api/reference/ads-pixel/shared_accounts/)
- [Meta Ads API Documentation - Cross-Platform Targeting](https://developers.facebook.com/docs/marketing-api/audiences/reference/basic-targeting/)
