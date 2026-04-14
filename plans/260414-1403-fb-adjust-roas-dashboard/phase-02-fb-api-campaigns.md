# Phase 02 — FB API Integration + Campaigns Route

## Context Links
- Parent plan: [plan.md](./plan.md)
- FB API research: [researcher-fb-api-report.md](./research/researcher-fb-api-report.md)
- Workspace API pattern: `C:\Work\Tools\fb-ads-tool\app\api\workspaces\[id]\route.ts`
- Utils: `C:\Work\Tools\fb-ads-tool\lib\utils.ts`

## Overview
- **Date:** 2026-04-14
- **Priority:** P1
- **Status:** pending (requires Phase 01)
- **Description:** Build `lib/facebook/` module and `/api/workspaces/[id]/campaigns` GET route that fetches live campaign data from FB Marketing API v21.

## Key Insights
- FB Graph API base URL: `https://graph.facebook.com/v21.0`
- Campaigns endpoint: `GET /act_{ad_account_id}/campaigns`
- Insights endpoint: `GET /{campaign_id}/insights` — async, use `time_range` + `time_increment=all`
- Budget fields are in **cents** — divide by 100 for display
- Insights lag: 6–48h; acceptable for this use case (user already expects delay vs Adjust)
- Rate limit: 200 calls/user/hour — no issue for single-user manual tool
- Pagination: cursor-based (`after` param), fetch all pages in server route
- Required fields on campaign: `id, name, status, effective_status, daily_budget, lifetime_budget, budget_remaining`
- Insights fields: `spend, impressions, clicks, cpm, cpc, actions`
- Token stored in `workspace.fb_access_token`; account ID in `workspace.fb_ad_account_id`

## Requirements
- `lib/facebook/fb-client.ts` — thin fetch wrapper with token injection and error handling
- `lib/facebook/campaigns.ts` — `fetchCampaigns(token, adAccountId, dateRange)` that returns merged campaign + insights data
- `GET /api/workspaces/[id]/campaigns?date_preset=today` — auth-gated, always fetches today's data, returns `CampaignRow[]`
- Handle missing token gracefully (return 400 with clear message)
- Paginate through all campaigns automatically

## Architecture

```
GET /api/workspaces/[id]/campaigns?date_preset=last_7d
  ↓
  1. Auth check (user session)
  2. Fetch workspace (verify ownership + get fb_access_token, fb_ad_account_id)
  3. Return 400 if token/account missing
  4. lib/facebook/campaigns.ts → fetchCampaigns()
       ↓ GET /act_{id}/campaigns (fields + insights batch)
       ↓ Paginate cursor
  5. Return CampaignRow[]

CampaignRow {
  campaign_id: string
  campaign_name: string
  status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DELETED'
  effective_status: string
  daily_budget: number | null    // dollars (converted from cents)
  lifetime_budget: number | null // dollars
  budget_remaining: number | null
  spend: number                  // from insights
  impressions: number
  clicks: number
  cpm: number
  cpc: number
  date_range: string
}
```

## Related Code Files

**Create:**
- `C:\Work\Tools\fb-ads-tool\lib\facebook\fb-client.ts`
- `C:\Work\Tools\fb-ads-tool\lib\facebook\campaigns.ts`
- `C:\Work\Tools\fb-ads-tool\app\api\workspaces\[id]\campaigns\route.ts`

**Modify:**
- `C:\Work\Tools\fb-ads-tool\lib\types.ts` — add `CampaignRow` type export

## Implementation Steps
1. Create `lib/facebook/fb-client.ts`:
   - Export `fbGet(path, params, token)` — wraps `fetch` to Graph API, handles non-2xx, returns parsed JSON
   - Export `fbPatch(path, body, token)` and `fbPost(path, body, token)` (used in Phase 05)
   - Always append `access_token` to params

2. Create `lib/facebook/campaigns.ts`:
   - `fetchCampaigns(token, adAccountId, datePreset)`:
     - GET `/act_{adAccountId}/campaigns` with fields `id,name,status,effective_status,daily_budget,lifetime_budget,budget_remaining,insights{spend,impressions,clicks,cpm,cpc}`
     - Use `date_preset` param (e.g. `last_7d`, `last_30d`, `this_month`)
     - Paginate: follow `paging.cursors.after` until no `next`
     - Flatten insights into campaign object
     - Convert budget fields from cents to dollars (÷100)
     - Return `CampaignRow[]`

3. Create `app/api/workspaces/[id]/campaigns/route.ts`:
   - GET handler: auth → workspace fetch → call `fetchCampaigns` → return JSON
   - Accept `?date_preset=last_7d` query param (default: `last_7d`)
   - Support `?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD` as alternative to preset

4. Add `CampaignRow` interface to `lib/types.ts`

## Todo List
- [ ] Create `lib/facebook/fb-client.ts` (fetch wrapper)
- [ ] Create `lib/facebook/campaigns.ts` (fetchCampaigns with pagination)
- [ ] Create `app/api/workspaces/[id]/campaigns/route.ts`
- [ ] Add `CampaignRow` to `lib/types.ts`
- [ ] Test: verify campaigns return with spend data for past 7 days

## Success Criteria
- `GET /api/workspaces/[id]/campaigns?date_preset=last_7d` returns array of campaigns with spend/budget data
- Missing token returns `400 { error: "Facebook credentials not configured. Go to Settings to add them." }`
- TypeScript compiles, no `any` types

## Risk Assessment
- **Insights lag:** FB insights can be 6–48h delayed — document clearly in UI
- **Cursor pagination:** Large ad accounts (100+ campaigns) need full pagination — must not return partial data
- **Token expiry:** 60-day token — no refresh logic needed now, just clear error message

## Security Considerations
- Token only used server-side in API route — never returned to client
- Workspace ownership verified before using token

## Next Steps
→ Phase 03: CSV upload + ROAS merge (runs in parallel with Phase 04 UI skeleton)
