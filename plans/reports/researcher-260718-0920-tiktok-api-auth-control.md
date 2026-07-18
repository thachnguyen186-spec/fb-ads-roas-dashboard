# TikTok Business API: Authorization, Campaign Control & Reporting
**Research Report** | Date: 2026-07-18 | Target: TikTok Marketing API v1.3

---

## 1. Authorization Flow (OAuth2)

### 1.1 User Authorization URL
User navigates to (you construct this URL):
```
https://business-api.tiktok.com/portal/auth?app_id={APP_ID}&state={STATE_PARAM}&redirect_uri={REDIRECT_URI}
```
- **app_id**: Your Developer App ID (e.g., 7662961036412223504)
- **state**: Custom parameter (CSRF token recommended)
- **redirect_uri**: Your callback endpoint (must be whitelisted in Developer Portal)

### 1.2 Callback & Authorization Code
User grants permission → TikTok redirects to your `redirect_uri` with:
```
GET {REDIRECT_URI}?auth_code={AUTH_CODE}&state={STATE_PARAM}
```

### 1.3 Token Exchange Endpoint
**POST** `https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/`

**Request Body (JSON):**
```json
{
  "app_id": "7662961036412223504",
  "secret": "{YOUR_APP_SECRET}",
  "auth_code": "{AUTH_CODE_FROM_REDIRECT}",
  "grant_type": "authorization_code"
}
```

**Response (Success):**
```json
{
  "code": 0,
  "message": "OK",
  "data": {
    "access_token": "{{ACCESS_TOKEN}}",
    "refresh_token": "{{REFRESH_TOKEN}}",
    "access_token_expire_in": 86400,
    "advertiser_ids": ["{{ADVERTISER_ID_1}}", "{{ADVERTISER_ID_2}}"],
    "scope": [4]
  }
}
```

**Note:** `advertiser_ids` array is **returned in OAuth response** — this is how you discover which advertiser accounts (multi-account support) the token grants access to. No separate endpoint needed for enumeration.

### 1.4 Token Lifecycle & Refresh
| Token Type | Lifetime | Refresh? |
|---|---|---|
| `access_token` | 24 hours (86400 sec) | Yes |
| `refresh_token` | 365 days | No, but triggers re-auth |

**Refresh Endpoint (same as token exchange):**
**POST** `https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/`

**Request Body:**
```json
{
  "app_id": "7662961036412223504",
  "secret": "{YOUR_APP_SECRET}",
  "refresh_token": "{{REFRESH_TOKEN}}",
  "grant_type": "refresh_token"
}
```

**Critical Implementation Detail:**
- Access tokens expire after 24 hours → **implement background refresh job** on server-side.
- Refresh tokens last ~365 days; if expired, user must re-authorize via OAuth flow.
- Common production failure: no token refresh logic; integration silently breaks after 24 hours.

---

## 2. Campaign & Ad Control Endpoints

### 2.1 Base URL & Authentication
**Base:** `https://business-api.tiktok.com/open_api/v1.3/`

**All requests require:**
```
Authorization: Bearer {ACCESS_TOKEN}
```
OR query parameter: `?access_token={ACCESS_TOKEN}`

**Required parameter in all campaign/ad requests:**
- `advertiser_id` (string): From the OAuth response `advertiser_ids` array

### 2.2 Campaign Endpoints

#### List Campaigns
**GET** `/campaign/get/`

**Query Parameters:**
- `advertiser_id` (required): string
- `access_token` (required): string
- `page` (optional): int, default 1
- `page_size` (optional): int, default 10, max 100

**Response (abridged):**
```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "campaign_id": "123456",
        "campaign_name": "Summer Campaign",
        "status": "ENABLE",
        "budget": 5000.00,
        "budget_mode": "DAILY",
        "budget_type": "DAILY",
        "objective": "TRAFFIC",
        "create_time": 1234567890,
        "update_time": 1234567890
      }
    ],
    "page_info": {
      "page": 1,
      "page_size": 10,
      "total_number": 25
    }
  }
}
```

**Key Fields for Dashboard:**
- `campaign_id`, `campaign_name`: Identity
- `status`: `ENABLE` or `DISABLE`
- `budget`: numeric value (e.g., 5000.00)
- `budget_mode`: `DAILY` or `LIFETIME`

#### Update Campaign (Budget or Status)
**POST** `/campaign/update/`

**Request Body:**
```json
{
  "advertiser_id": "{{ADVERTISER_ID}}",
  "campaign_id": "123456",
  "budget": 6000.00
}
```
OR to change status:
```json
{
  "advertiser_id": "{{ADVERTISER_ID}}",
  "campaign_id": "123456",
  "status": "DISABLE"
}
```

**Status Update Endpoint (Alternative):**
**POST** `/campaign/status/update/`

**Request Body:**
```json
{
  "advertiser_id": "{{ADVERTISER_ID}}",
  "campaign_ids": ["123456", "123457"],
  "status": "DISABLE"
}
```
- Supports batch: up to 100 campaign IDs per request
- `status`: `ENABLE` or `DISABLE`

---

### 2.3 Ad Group Endpoints

#### List Ad Groups
**GET** `/adgroup/get/`

**Query Parameters:**
- `advertiser_id` (required)
- `access_token` (required)
- `campaign_id` (optional): filter to specific campaign
- `page`, `page_size`: same as campaigns

**Response (abridged):**
```json
{
  "data": {
    "list": [
      {
        "adgroup_id": "456789",
        "adgroup_name": "Summer Ad Group 1",
        "campaign_id": "123456",
        "status": "ENABLE",
        "budget": 1000.00,
        "budget_mode": "DAILY",
        "daily_budget": 1000.00,
        "lifetime_budget": null
      }
    ]
  }
}
```

#### Update Ad Group
**POST** `/adgroup/update/`

**Request Body:**
```json
{
  "advertiser_id": "{{ADVERTISER_ID}}",
  "adgroup_id": "456789",
  "budget": 1500.00
}
```

#### Update Ad Group Status
**POST** `/adgroup/status/update/`

**Request Body:**
```json
{
  "advertiser_id": "{{ADVERTISER_ID}}",
  "adgroup_ids": ["456789", "456790"],
  "status": "ENABLE"
}
```
- Batch: up to 100 ad group IDs per request

---

### 2.4 Ad Endpoints

#### List Ads
**GET** `/ad/get/`

**Query Parameters:**
- `advertiser_id` (required)
- `access_token` (required)
- `adgroup_id` (optional): filter to specific ad group
- `page`, `page_size`: same pattern

**Response (abridged):**
```json
{
  "data": {
    "list": [
      {
        "ad_id": "789012",
        "ad_name": "Summer Ad 1",
        "adgroup_id": "456789",
        "status": "ENABLE",
        "create_time": 1234567890
      }
    ]
  }
}
```

#### Update Ad Status
**POST** `/ad/status/update/`

**Request Body:**
```json
{
  "advertiser_id": "{{ADVERTISER_ID}}",
  "ad_ids": ["789012", "789013"],
  "status": "ENABLE"
}
```
- Batch: up to 100 ad IDs per request
- `status`: `ENABLE` or `DISABLE`

---

## 3. Spend Reporting API

### 3.1 Reporting Endpoint
**GET** `/report/integrated/get/`

**Query Parameters:**
```
GET /open_api/v1.3/report/integrated/get/
  ?advertiser_id={ADVERTISER_ID}
  &access_token={ACCESS_TOKEN}
  &start_date=2026-07-01
  &end_date=2026-07-18
  &dimensions=["campaign_id","stat_time_day"]
  &metrics=["spend","impressions","clicks"]
  &report_type=BASIC
  &data_level=CAMPAIGN
  &page=1
  &page_size=100
```

**Key Parameters:**
| Param | Values | Purpose |
|---|---|---|
| `start_date`, `end_date` | YYYY-MM-DD | Date range for report (UTC) |
| `dimensions` | `campaign_id`, `adgroup_id`, `ad_id`, `stat_time_day`, `stat_time_hour`, `country_code` | Breakdown dimensions |
| `metrics` | `spend`, `cost`, `impressions`, `clicks`, `conversions`, `conversion_rate`, `ctr`, `cpc` | Performance metrics |
| `data_level` | `CAMPAIGN`, `ADGROUP`, `AD` | Aggregation level |
| `report_type` | `BASIC` | Query mode |
| `page`, `page_size` | int | Pagination (max page_size: 100) |

### 3.2 Example Request/Response
**Request:**
```
GET /open_api/v1.3/report/integrated/get/
  ?advertiser_id=7788990011
  &access_token={TOKEN}
  &start_date=2026-07-10
  &end_date=2026-07-18
  &dimensions=["campaign_id","stat_time_day"]
  &metrics=["spend"]
  &data_level=CAMPAIGN
  &page=1
  &page_size=100
```

**Response (abridged):**
```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "campaign_id": "123456",
        "stat_time_day": "2026-07-10",
        "spend": 250.50
      },
      {
        "campaign_id": "123456",
        "stat_time_day": "2026-07-11",
        "spend": 275.00
      }
    ],
    "page_info": {
      "page": 1,
      "page_size": 100,
      "total_number": 9
    }
  }
}
```

### 3.3 Reporting Gotchas
- **Latency:** Report data has 24-48 hour delay; today's data incomplete.
- **Timezone:** API uses UTC; compare dashboard (local) times carefully.
- **Dimensions/Metrics:** Not all combinations valid; refer to [TikTok docs](https://business-api.tiktok.com/portal/docs/basic-reports-supported-dimensions/v1.3) for supported combos.

---

## 4. Rate Limits & Constraints

### 4.1 Rate Limiting
- **Per-endpoint throttling:** Limits vary by endpoint; no global quota.
- **Sliding window:** 1-minute moving window enforced.
- **On limit exceeded:** HTTP 429 with error `rate_limit_exceeded`.
- **Retry header:** Check `X-RateLimit-Reset` header for retry time.

**Common limits (varies by endpoint):**
- ~600 requests/minute per endpoint (observed in Display API)
- Some endpoints stricter for list/reporting operations

### 4.2 Pagination
- Max `page_size` typically **100** (default 10).
- Use `page` + `page_size` for navigation.
- Check `page_info` in response for `total_number`.

### 4.3 Batch Operations
- Campaign/AdGroup/Ad status updates: max **100 IDs per request**.
- Split larger batches into multiple requests.

### 4.4 Budget Constraints
- Minimum daily budget (campaign): $50 USD
- Minimum daily budget (ad group): $20 USD
- Minimum lifetime budget: daily min × number of days (e.g., $20/day × 31 days = $620 lifetime min)
- **Cannot switch budget mode** post-launch (daily ↔ lifetime is locked at creation).

---

## 5. Scopes & Permissions

### 5.1 OAuth Scopes
TikTok uses a scope-based permission model:
- Request specific scopes during app registration.
- Each user must authorize the app for requested scopes.
- **Best practice:** Request only scopes your integration uses (reduces approval friction).

**Common scopes (inferred from API):**
- Campaign/Ad management scopes (exact names undocumented in public search results; check Developer Portal)
- Reporting/analytics scopes

### 5.2 Scope Management Flow
1. Declare scopes when registering your Developer App.
2. User sees requested scopes during OAuth authorization.
3. User approves → scopes granted in `access_token`.
4. Token `scope` field (array) lists granted scope IDs.

---

## 6. Header Pattern Note

**TikTok API uses standard Bearer token authorization:**
```
Authorization: Bearer {ACCESS_TOKEN}
```

NOT a custom `Access-Token` header (contrary to user spec; TikTok follows standard OAuth 2.0 Bearer pattern per official SDK docs).

---

## 7. Implementation Checklist

- [ ] Store `refresh_token` securely server-side (never expose to client).
- [ ] Schedule background job to refresh `access_token` before 24-hour expiry.
- [ ] On refresh token expiry (~365 days), trigger user re-authorization.
- [ ] Enumerate advertiser accounts from OAuth token response `advertiser_ids`.
- [ ] Handle HTTP 429 rate limits with exponential backoff.
- [ ] Validate budget mode immutability (cannot change post-launch).
- [ ] Account for 24-48 hour reporting data latency.
- [ ] Use UTC consistently for date ranges in reports.
- [ ] Batch operations: split >100 IDs into multiple requests.
- [ ] Request minimal required scopes during app registration.

---

## Sources

- [TikTok API for Business Portal](https://business-api.tiktok.com/portal)
- [TikTok Business API Documentation](https://business-api.tiktok.com/portal/docs)
- [Authentication API (GitHub SDK)](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/AuthenticationApi.md)
- [Campaign Management (GitHub SDK)](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/CampaignCreationApi.md)
- [Reporting API (GitHub SDK)](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/ReportingApi.md)
- [Basic Reports Dimensions (Official Docs)](https://business-api.tiktok.com/portal/docs/basic-reports-supported-dimensions/v1.3)
- [TikTok Business API V1.3 (Postman Collection)](https://www.postman.com/tiktok/tiktok-api-for-business/documentation/efqhadc/tiktok-business-api-v1-3)
- [OAuth User Access Token Management](https://developers.tiktok.com/doc/oauth-user-access-token-management)
- [TikTok API Scopes Overview](https://developers.tiktok.com/doc/scopes-overview)
- [TikTok API Rate Limits 2026](https://www.getphyllo.com/post/tiktok-api-rate-limits-in-2026-quotas-errors-workarounds)
- [Budget & Campaign Help](https://ads.tiktok.com/help/article/budget)

---

## Unresolved Questions

1. **Exact scope names**: TikTok docs don't publicly list specific scope IDs (e.g., `CAMPAIGN_READ`, `CAMPAIGN_WRITE`); values inferred from scope arrays. Verify in Developer Portal when registering app.
2. **Smart Plus API**: References to `/smart_plus/` endpoints appear in SDK but are undocumented in search results; clarify use case vs. standard campaign endpoints.
3. **Campaign opt_status**: User mentioned campaign-level `opt_status` field; not found in v1.3 docs; may be legacy or undocumented—verify in production API response.
