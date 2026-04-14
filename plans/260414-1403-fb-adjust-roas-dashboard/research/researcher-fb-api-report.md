---
name: Facebook Marketing API v21 Campaign Management Research
type: research
date: 2026-04-14
---

# Facebook Marketing API v21+ Research: Campaign Management

## 1. Campaign Endpoints

### List Campaigns
```
GET /act_{AD_ACCOUNT_ID}/campaigns
```
**Fields available:**
- `id`, `name`, `objective`, `status` (ACTIVE, PAUSED, DELETED, ARCHIVED)
- `daily_budget`, `lifetime_budget` (in cents)
- `start_time`, `stop_time`, `created_time`, `updated_time`
- `effective_status` (ACTIVE, PAUSED, SCHEDULED, COMPLETED, ARCHIVED, FAILED)
- `spend` (native field or via insights)
- **Default pagination:** 25 results, cursor-based

### Get Campaign Details & Update
```
GET /id  → Read campaign state
PATCH /id → Update fields
```
**Updatable fields:**
- `status` (PAUSED, ACTIVE) → Direct field update
- `daily_budget` (in cents, e.g., 500000 = $5 USD)
- `lifetime_budget` (in cents, same format)
- `name`, `start_time`, `stop_time`

**Example PATCH request:**
```json
{
  "status": "PAUSED",
  "daily_budget": 500000
}
```

### Duplicate Campaign
```
POST /act_{AD_ACCOUNT_ID}/campaigns
Body: {
  "copy_from": "{CAMPAIGN_ID}",
  "name": "New Name",
  "status": "PAUSED"
}
```

## 2. Campaign Insights Endpoint

### Fetch Insights
```
GET /{CAMPAIGN_ID}/insights
```
**Key parameters:**
- `time_range`: `{"since":"2026-04-01","until":"2026-04-14"}` (date format YYYY-MM-DD)
- `time_increment`: 1 (daily), 7 (weekly), 28 (monthly)
- `fields`: comma-separated list

**Available metrics:**
- `spend` (float, currency)
- `impressions` (integer)
- `clicks` (integer)
- `cpc` (cost per click, float)
- `cpm` (cost per 1000 impressions, float)
- `ctr` (click-through rate, float 0-100)
- `actions` (conversions; returns action_type breakdown)
- `action_values` (revenue/value; requires conversion pixel)
- `video_views`, `video_play_actions`
- `date_start`, `date_stop` (for breakdown_by_time queries)

**Note:** Insights are delayed ~6-48 hours from real-time. ALWAYS use `time_increment: 1` for daily data. Avoid requesting future dates.

## 3. Authentication

### Token Types
| Type | Use Case | Recommendation |
|------|----------|---|
| **User Access Token** | Single person tool; tied to user account | **RECOMMENDED for your use case** |
| **System User Token** | App-level automation, business account management | Not needed for single-user tool |

**Why User Access Token:** Simpler, no separate system user setup, tied to user's account permissions, revocable per user.

**Scopes required:**
- `ads_management` (read/write campaigns, budgets, status)
- `ads_read` (read insights, analytics)
- `business_management` (if reading ad account details)

Token lifespan: ~60 days; refresh via OAuth flow. Non-expiring tokens available if enabled.

## 4. Rate Limits & Pagination

### Rate Limiting
- **Standard:** 200 calls/user/hour (per app)
- **Tier 2:** 1000 calls/user/hour (on request)
- **Tier 3:** 10,000 calls/user/hour (app review + contract)
- **Adaptive limiting:** FB may throttle if burst detected

**Mitigation:** Cache results, batch requests, implement exponential backoff (retry after 429 with `Retry-After` header).

### Pagination
**Cursor-based only** (no offset). Response format:
```json
{
  "data": [...],
  "paging": {
    "cursors": {
      "before": "...",
      "after": "..."
    }
  }
}
```
**Limit:** Use `limit=100` (max 100) to fetch up to 100 items per call.

## 5. Ad Account ID Format

Format: `act_XXXXXXXX` (e.g., `act_123456789`)
- Always prefixed with `act_`
- Numeric ID (no hyphens)
- Retrieve via: `GET /me/adaccounts` → returns list of accessible accounts
- User must have ADMIN or EDITOR role on account

## 6. Required Permissions & Scopes

**Minimum scopes for your tool:**
1. `ads_management` — campaign CRUD, budget updates, status changes
2. `ads_read` — insights access

**Permission checks:**
- Check `GET /{AD_ACCOUNT_ID}` returns 200 before proceeding
- If 403, user lacks ADMIN/EDITOR role on account
- If 404, account ID invalid or user has no access

## Key Implementation Notes

- **Budget precision:** Always work in cents (50 USD = 5000 in API)
- **Status updates are synchronous:** PATCH returns immediately
- **Insights queries are asynchronous:** May return partial data if querying recent dates
- **Campaign duplication:** Copies adsets + ads; adjust targeting/budget afterward
- **Test mode:** Use `is_test=true` param (v2.13+) for dry-run updates (limited availability)
- **Effective status vs status:** `effective_status` reflects system state; `status` is user-set
- **Date filtering:** Use `since/until` in insights; campaign `start_time/stop_time` for scheduling

## Unresolved Questions

1. Does `copy_from` endpoint support copying to different ad account? (Cross-account duplication.)
2. Is there a bulk update endpoint for multiple campaigns, or single PATCH per campaign?
3. What's the exact lag time for insights data—is 6-48 hours still accurate for v21?
4. Can `lifetime_budget` be updated mid-flight, or is it immutable after campaign starts?
5. Which insights fields require conversion pixel setup vs available by default?
