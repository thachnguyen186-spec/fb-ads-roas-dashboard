# TikTok Business API v1.3: Campaign, AdGroup, Ad Creation & Creative Management

**Report Date:** 2026-07-18  
**API Version:** v1.3  
**Base URL:** `https://business-api.tiktok.com`

---

## 1. Campaign/AdGroup/Ad Creation Endpoints

### Campaign Creation: `POST /open_api/v1.3/campaign/create/`

**Required Fields:**
- `advertiser_id` (string): Advertiser account ID
- `campaign_name` (string): Campaign display name
- `objective_type` (string): Campaign goal (see [Objective Types](#objective-types))

**Important Optional Fields:**
- `budget` (number): Total budget for campaign lifecycle
- `budget_mode` (enum): `BUDGET_MODE_DAY`, `BUDGET_MODE_TOTAL`, `BUDGET_MODE_INFINITE`
- `operation_status` (string): `ENABLE` (default), `DISABLE`
- `bid_type` (string): Bidding strategy override (e.g., `BID_TYPE_NO_BID`)
- `optimization_goal` (string): Campaign-level optimization target
- `virtual_objective_type` (string): Specialized campaign variant (optional)

**Response:** Returns `campaign_id` for downstream ad group creation

**Example (Simplified):**
```json
{
  "advertiser_id": "1234567890",
  "campaign_name": "Summer Sale Campaign",
  "objective_type": "CONVERSIONS",
  "budget": 5000,
  "budget_mode": "BUDGET_MODE_TOTAL"
}
```

---

### Ad Group Creation: `POST /open_api/v1.3/adgroup/create/`

**Required Fields:**
- `advertiser_id` (string): Advertiser ID
- `campaign_id` (string): Parent campaign ID (from campaign/create response)
- `adgroup_name` (string): Ad group display name
- `billing_event` (enum): `CPC`, `CPM`, `OCPC`, `CPA`, `OPT` (optimization)
- `budget` (number): Ad group budget (daily or total per `budget_mode`)
- `budget_mode` (enum): `BUDGET_MODE_DAY`, `BUDGET_MODE_TOTAL`
- `optimization_goal` (enum): `IMPRESSIONS`, `CLICKS`, `CONVERSIONS`, `REACH`, `APP_INSTALLS`, `VIDEO_VIEWS`, `LEADS`, etc.
- `pacing` (enum): `STANDARD`, `ACCELERATED`
- `schedule_type` (enum): `SCHEDULE_FROM_NOW`, `SCHEDULE_START_END`
- `schedule_start_time` (number): Unix timestamp for start (required if `SCHEDULE_START_END`)
- `schedule_end_time` (number): Unix timestamp for end (optional)

**Bidding Configuration (at least one required):**
- `bid_type` (enum): `BID_TYPE_NO_BID`, `BID_TYPE_MANUAL`, `BID_TYPE_AUTO`
- `bid_price` (number): Manual bid amount (cents, e.g., 5 = $0.05)
- `conversion_bid_price` (number): Target cost per conversion
- `deep_cpa_bid` (number): Deep learning CPA bid
- `roas_bid` (number): Return-on-ad-spend target

**Targeting Fields** (OR logic within dimension, AND across dimensions):
- `age_groups` (array): `["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"]`
- `gender` (enum): `GENDER_UNSPECIFIED`, `GENDER_MALE`, `GENDER_FEMALE`
- `location_ids` (array): Country/region IDs (numeric)
- `languages` (array): Language codes (e.g., `["en", "es"]`)
- `device_model_ids` (array): Device model codes
- `operating_systems` (array): `["IOS", "ANDROID", "WINDOWS"]`
- `interest_category_ids` (array): Interest/behavioral category IDs
- `purchase_intention_keyword_ids` (array): Shopping intent categories
- `custom_audience_ids` (array): Retargeting audience IDs

**Placement Configuration:**
- `placement_type` (enum): `PLACEMENT_TYPE_NORMAL`, `PLACEMENT_TYPE_SHOP`
- `placements` (array): Specific TikTok placements within network

**Response:** Returns `adgroup_id` for downstream ad creation

**Example (Simplified):**
```json
{
  "advertiser_id": "1234567890",
  "campaign_id": "abc123def456",
  "adgroup_name": "Mobile Users USA",
  "billing_event": "CPC",
  "budget": 1000,
  "budget_mode": "BUDGET_MODE_DAY",
  "optimization_goal": "CONVERSIONS",
  "bid_type": "BID_TYPE_AUTO",
  "pacing": "STANDARD",
  "schedule_type": "SCHEDULE_FROM_NOW",
  "schedule_start_time": 1721356800,
  "location_ids": [1, 2],
  "age_groups": ["18-24", "25-34"]
}
```

---

### Ad Creation: `POST /open_api/v1.3/ad/create/`

**Required Fields:**
- `advertiser_id` (string): Advertiser ID
- `adgroup_id` (string): Parent ad group ID
- `ad_name` (string): Ad display name
- `creative_id` (string): Pre-uploaded video or image asset ID (from `/file/video/ad/upload/` or `/file/image/ad/upload/`)

**Ad-Level Creative Configuration:**
- `ad_text` (string): Primary ad copy / description (max 500 chars typically)
- `call_to_action_id` (string): CTA type identifier (e.g., `LEARN_MORE`, `SHOP_NOW`, `INSTALL`, `WATCH_MORE`)
- `landing_page_url` (string): Destination URL for ad click
- `landing_page_url_title` (string): Title displayed on landing page link

**Identity & Attribution:**
- `identity_id` (string): Page/profile ID to associate ad with (business account, shop, etc.)
- `identity_type` (enum): `IDENTITY_TYPE_BUSINESS_ACCOUNT`, `IDENTITY_TYPE_SHOP`, `IDENTITY_TYPE_TIKTOK_ACCOUNT`, `IDENTITY_TYPE_TIKTOK_CREATOR_ID`
- `display_name` (string): Brand/account name shown in ad footer

**Optional Advanced Fields:**
- `video_sound_type` (enum): `ORIGINAL`, `MUTED`, `PLATFORM_DEFAULT`
- `video_user_comment_status` (enum): `ALLOW_COMMENTS`, `DISABLE_COMMENTS`
- `video_user_interaction_status` (enum): `ALLOW_DUETS`, `ALLOW_STITCH`, `DISABLE_INTERACTION`

**Response:** Returns `ad_id` and status

**Example (Simplified):**
```json
{
  "advertiser_id": "1234567890",
  "adgroup_id": "xyz789uvw012",
  "ad_name": "Summer Sale Ad #1",
  "creative_id": "video_12345",
  "ad_text": "Check out our exclusive summer collection!",
  "call_to_action_id": "SHOP_NOW",
  "landing_page_url": "https://myshop.com/summer",
  "identity_id": "page_98765",
  "identity_type": "IDENTITY_TYPE_BUSINESS_ACCOUNT",
  "display_name": "My Brand"
}
```

---

## 2. Campaign Duplication: Client-Side Required

**Status:** TikTok Business API v1.3 **does NOT provide a native duplicate/copy endpoint**.

**Workaround (Client-Side Implementation):**

1. **Read Campaign Structure:**
   ```
   GET /open_api/v1.3/campaign/get/
   GET /open_api/v1.3/adgroup/get/
   GET /open_api/v1.3/ad/get/
   ```

2. **Clone and Modify:** Programmatically iterate through nested structure, update:
   - Campaign name (append suffix, e.g., " - Copy 2")
   - Budget (if needed)
   - Pause original or new campaign if required

3. **Re-POST via Create Endpoints:** Submit modified structure through the standard `/campaign/create/`, `/adgroup/create/`, `/ad/create/` flow

**Limitations:**
- Smart Performance Campaigns (SPC) and Product Sales campaigns **cannot** be duplicated (API restriction)
- Upgraded Smart+ campaigns **can** be duplicated
- All duplicates are created with **"Inactive" status** — separate activation step required

**Gotcha:** This is a multi-step, sequential process. You cannot use a single "deep copy" call like Facebook's `deep_copy=true` parameter. Orchestrate via client logic.

---

## 3. Creative Asset Management

### Video Upload: `POST /open_api/v1.3/file/video/ad/upload/`

**Required Parameters:**
- `advertiser_id` (string): Advertiser ID
- `upload_type` (enum): Upload method (see below)
- One of: `video_file`, `video_url`, or `file_id` (depending on `upload_type`)

**Upload Type Options:**
- `UPLOAD_BY_FILE`: Direct binary upload
  - Required: `video_file` (binary), `video_signature` (MD5 hash for verification)
- `UPLOAD_BY_URL`: Upload from public URL
  - Required: `video_url` (string)
- `UPLOAD_BY_FILE_ID`: Reference pre-uploaded file from repository
  - Required: `file_id` (string, from `/file/upload/` endpoint)

**Optional:**
- `video_name` (string): Asset library display name (1-100 chars, auto-truncated)

**Video Constraints:**
| Constraint | Value |
|------------|-------|
| **Duration** | 3-10 min (3 min default for most accounts; 10 min for eligible accounts; 60 min via web UI) |
| **Format** | MP4, MOV |
| **Video Codec** | H.264, H.265 (HEVC) |
| **Audio Codec** | AAC |
| **Audio Sample Rate** | 44.1 kHz (minimum) |
| **Resolution (min)** | 540 x 960 px (vertical); will be upscaled by TikTok if lower |
| **Resolution (recommended)** | 1080 x 1920 px (9:16 vertical) |
| **Aspect Ratios Supported** | 9:16 (primary), 1:1 (square), 16:9 (landscape) |
| **File Size (mobile)** | ~72-288 MB (platform-dependent) |
| **File Size (web)** | Up to 4 GB |

**Response:**
```json
{
  "data": {
    "video_id": "v_abc123def456"
  }
}
```

Reference `video_id` in `/ad/create/` via `creative_id` parameter.

---

### Image Upload: `POST /open_api/v1.3/file/image/ad/upload/`

**Required Parameters:**
- `advertiser_id` (string): Advertiser ID
- `upload_type` (enum): Upload method
- One of: `image_file`, `image_url`, or `file_id`

**Upload Type Options:**
- `UPLOAD_BY_FILE`: Direct binary upload
  - Required: `image_file` (binary), `image_signature` (MD5 hash)
- `UPLOAD_BY_URL`: Upload from public URL
  - Required: `image_url` (string)
- `UPLOAD_BY_FILE_ID`: Reference pre-uploaded file
  - Required: `file_id` (string)

**Optional:**
- `file_name` (string): Asset library name (1-100 chars)

**Image Constraints:**
| Constraint | Value |
|------------|-------|
| **Format** | PNG, JPG, JPEG |
| **Aspect Ratios** | 9:16 (vertical), 1:1 (square), 16:9 (landscape) |
| **Resolution (min)** | 720 x 1280 px (vertical) |
| **Resolution (recommended)** | 1200 x 628 px (horizontal), 640 x 640 px (square), 720 x 1280 px (vertical) |
| **File Size (standard ad)** | Up to 500 MB |
| **File Size (carousel ad)** | 100 KB per image maximum |

**Response:**
```json
{
  "data": {
    "image_id": "img_xyz789uvw012"
  }
}
```

Reference `image_id` in `/ad/create/` via `creative_id` parameter.

---

## 4. Objective Types & Campaign Hierarchy

### Available Objective Types (Campaign-Level)

| Category | Objective | Enum Value | Notes |
|----------|-----------|-----------|-------|
| **Awareness** | Reach | `REACH` | Maximize impressions to target audience |
| **Consideration** | Traffic | `TRAFFIC` | Drive clicks to landing page |
| | Video Views | `VIDEO_VIEWS` | Maximize video watch time |
| | Lead Generation | `LEAD_GENERATION` | Collect leads via form |
| | Community Interaction | `COMMUNITY_INTERACTION` | Grow followers, profile/page visits |
| | App Promotion | `APP_INSTALLS` or `APP_PROMOTION` | Drive app installations/engagement |
| | Brand Consideration (Beta) | `BRAND_CONSIDERATION` | Mid-funnel awareness-to-conversion bridge |
| **Conversion** | Conversions | `CONVERSIONS` | Drive purchases, signups, or in-app actions |

### Hierarchy Comparison: TikTok vs. Facebook

| Aspect | TikTok API v1.3 | Facebook Marketing API |
|--------|-----------------|----------------------|
| **Levels** | Campaign → Ad Group → Ad (3 levels) | Campaign → Ad Set → Ad (3 levels) |
| **Budget Level** | Campaign + Ad Group | Campaign + Ad Set |
| **Targeting** | Ad Group | Ad Set |
| **Bidding** | Ad Group | Ad Set |
| **Creative Storage** | Asset Library (separate upload) | Asset Library (separate upload) |
| **Duplication** | Client-side only | Native `deep_copy=true` parameter |
| **Smart Automation** | Smart+ (full automation) | Campaign Budget Optimization (CBO) + ABO |
| **Hierarchy Levels** | Fixed 3 levels | Fixed 3 levels |

**Key Difference:** TikTok's Smart+ campaigns automate audience targeting, bidding, and creative selection at the campaign level, whereas Facebook's CBO leaves granular control available. Standard TikTok campaigns require explicit ad group targeting setup (same as Facebook).

---

## 5. Data Model Implications for Duplication Feature

### Required Data Capture for Duplicate UI:

To support a future "duplicate campaign with edits" feature, your data model should store/expose:

**Campaign Level:**
- `objective_type`, `budget`, `budget_mode`, `operation_status`

**Ad Group Level:**
- `age_groups`, `gender`, `location_ids`, `languages`
- `billing_event`, `optimization_goal`, `bid_type`, `bid_price`
- `placement_type`, `placements`
- `schedule_start_time`, `schedule_end_time`, `pacing`

**Ad Level:**
- `ad_name`, `ad_text`, `call_to_action_id`, `landing_page_url`
- `identity_id`, `identity_type`, `display_name`
- `creative_id` (reference to video/image asset)

**Creative Level:**
- `video_id` / `image_id`, `video_name` / `file_name`
- Pre-upload metadata (duration, resolution, file size)

### Workflow Implications:

1. **Read Phase:** Fetch full campaign + nested ad groups/ads via GET endpoints
2. **Transform Phase:** Clone structure, update human-facing fields (names, URLs, budget)
3. **Write Phase:** POST new campaign/ad groups/ads sequentially (must wait for ID response at each level)
4. **Asset Reuse:** Optionally reuse same `creative_id` or re-upload new creative

---

## 6. Gotchas & Notable Differences from Facebook Ads API

1. **Sequential Creation Required:** Cannot create campaign, ad groups, and ads in parallel. Must chain calls (campaign_id → adgroup_id → ad_id). No atomic transaction.

2. **No Native Duplicate Endpoint:** Facebook has `POST /{campaign_id}/copies?deep_copy=true`. TikTok requires client-side orchestration.

3. **Inactive Status on Duplication:** Duplicated campaigns default to "Inactive" (even if original was active). Separate activation call required.

4. **Smart+ Campaign Restrictions:** Cannot duplicate SPC (Smart Performance Campaign) or Product Sales campaigns via API. Upgraded Smart+ only.

5. **Targeting is Ad Group, Not Campaign:** Unlike some Facebook setups, TikTok targeting (age, location, interests) lives at the ad group level, not campaign. Budget modes (`BUDGET_MODE_DAY` vs. `BUDGET_MODE_TOTAL`) affect per-ad-group spend pacing.

6. **Video Duration Varies by Account Eligibility:** Most accounts cap at 3 minutes; 10-minute uploads require account-level feature unlock; web UI allows up to 60 minutes. Check account limits before user uploads 10+ min videos.

7. **Creative Upload is Async:** Uploading video/image returns `video_id` / `image_id` immediately, but asset may still be processing. Ad creation may fail if asset processing incomplete. Implement polling or retry logic.

8. **Identity & Display Name Visibility:** `identity_id` and `display_name` determine which brand/page shows in the ad footer. Mismatched identity can cause review failure.

9. **Call-to-Action (CTA) Constraints:** Not all CTAs are available for all objective types. E.g., `SHOP_NOW` requires commerce eligibility. Validate CTA against objective at ad creation time.

10. **Rate Limits & Multi-Step Overhead:** Campaign creation is 3–5 API calls minimum (campaign, adgroup, ad, plus asset uploads). Factor into rate limit budgeting (typical limits: 100–500 requests/min depending on tier).

---

## Unresolved Questions

1. **Smart Plus Campaign Structure:** Does the v1.3 API support the announced 4-level structure (campaign, ad group, ad, creative) with creative-level optimization? Or is this UI-only?
2. **Dynamic Daily Budget:** `BUDGET_MODE_INFINITE` and dynamic budget allocation details not fully documented. Does TikTok auto-scale spend like Facebook's ABO?
3. **Exact Ad Review Delays:** Post-creation, how long before ads enter review queue? Is there a webhook to notify on approval/rejection?
4. **Asset Library Cleanup:** After campaign deletion, are associated assets retained or purged? Can assets be safely re-referenced across campaigns?
5. **Targeting Audience Size Estimation:** Is there a `/audience/estimate/` endpoint equivalent to Facebook's, or must users estimate audience size client-side?

---

## Sources

- [TikTok Business API Documentation Portal](https://business-api.tiktok.com/portal/docs)
- [TikTok Business API SDK - GitHub](https://github.com/tiktok/tiktok-business-api-sdk)
- [TikTok Marketing API v1.3 Explained (Soku, 2026)](https://soku.ai/blog/tiktok-marketing-api-v1-3-explained)
- [TikTok Ads Campaign Structure Guide](https://tlinky.com/tiktok-ads-campaign-structure/)
- [TikTok Ad Specifications (2026)](https://rule1.ai/articles/tiktok-ad-specs)
- [TikTok Campaign Objectives Help Article](https://ads.tiktok.com/help/article/choose-right-objective)
- [TikTok Ads API Tutorial - Ads Manager](https://www.kitchn.io/blog/tiktok-ads-api-introduction)
