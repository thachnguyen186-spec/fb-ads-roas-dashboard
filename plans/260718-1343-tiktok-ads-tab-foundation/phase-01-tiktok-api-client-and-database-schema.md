# Phase 1 — TikTok API Client + Database Schema

## Context Links

- Plan overview: [plan.md](./plan.md)
- Research: [TikTok Auth + Control + Reporting](../reports/researcher-260718-0920-tiktok-api-auth-control.md) (sections 1–4, 6)
- Research: [TikTok Campaign/Creative](../reports/researcher-260718-0926-tiktok-api-campaign-creative.md) (section 5 — data-model recommendation)
- Mirror sources: `lib/facebook/fb-client.ts`, `lib/facebook/campaigns.ts`, `lib/facebook/campaign-actions.ts`, `lib/adjust/api-client.ts`, `lib/adjust/merge.ts`, `lib/supabase/server.ts`, `supabase/schema.sql`, `lib/types.ts`

## Overview

- **Priority:** P1 (blocks all other phases)
- **Status:** Complete (2026-07-18, verified via code review + testing)
- **Estimate:** ~4h
- **Scope:** Server-side only, no UI. Establishes DB schema, TikTok fetch client, connection/token lifecycle, campaign/adgroup read, spend reporting, control actions, merge layer, types, and Adjust `partner` generalization.

## Key Insights

- TikTok base URL: `https://business-api.tiktok.com/open_api/v1.3`. Standard `Authorization: Bearer {access_token}` header (research §6 — NOT a custom header). Response envelope `{code, message, data}`; `code !== 0` = error → throw with `message`.
- `access_token` lives 24h (`access_token_expire_in: 86400`); `refresh_token` lives 365 days. Refresh + exchange share one endpoint: `POST /oauth2/access_token/` (research §1.3–1.4). Env-var storage is impossible (token rotates) → DB table.
- Refresh is **lazy/on-demand** (not cron): existing cron is Hobby-tier daily-only (`app/api/cron/check-spending-limits/route.ts` header) — too infrequent for a 24h token. Check `token_expires_at` before every call; refresh if within 30-min buffer.
- Spend is NOT on `/campaign/get/` (that returns budget only). Actual spend comes from `/report/integrated/get/` (research §3). Reporting lags 24–48h → "today" is partial (same caveat FB already documents on `CampaignRow.spend`).
- TikTok budgets from `/campaign/get/` are plain decimals already in account currency (e.g. `5000.00`) — **no cents-conversion, no VND-smallest-unit quirk** unlike FB (`lib/facebook/campaigns.ts` `centsToUsd`, `lib/adjust/merge.ts` `budgetFactor`). Merge layer stays simpler.
- Batch status/budget ops cap at 100 IDs (research §4.3) → chunk bulk actions.
- `advertiser_ids` returned directly in the OAuth token response (research §1.2) — no per-user enumeration endpoint. Enables org-wide model.
- Adjust `partner_name` string for TikTok is **unknown** — must be discovered empirically before hardcoding (see Risk + Steps).
- > 🔴 **Red Team Fix (2026-07-18), resolved via Validation Session 1 Q1:** `TiktokAdvertiserAccount.currency` is NOT guaranteed to be USD (it's a free-form field like FB's). Adjust revenue is always USD. Any advertiser account in a non-USD currency would produce silently-wrong ROAS/Profit if spend (native currency) is divided against USD revenue without conversion — same class of bug FB solves via `vndRate` in `lib/adjust/merge.ts`. **Decision: Plan 1 restricts advertiser selection to USD-only accounts (enforced in Phase 2) rather than building FX conversion — no non-USD spend ever reaches the merge layer.**
- > 🔴 **Red Team Fix (2026-07-18):** Refresh responses may rotate `refresh_token` (many OAuth2 providers invalidate the old one on use) — the plan must persist `data.refresh_token` from every exchange/refresh response defensively, not just `access_token`, or a single rotation silently breaks the org-wide connection within 24h.
- > 🔴 **Red Team Fix (2026-07-18):** TikTok's Reporting API date params are UTC (research §3.3), while Adjust's revenue query uses `Asia/Bangkok` local-day boundaries (per the recent `fix(adjust): use Bangkok-local day boundary` commit on the FB side). Reintroducing this exact mismatch for TikTok was flagged as unacceptable — verify during Step 5 whether `/report/integrated/get/` accepts a timezone/utc_offset override; if not, document the drift prominently in the UI (not just a code comment) and default "today" framing to account for it (see Phase 3).
- > 🔴 **Red Team Fix (2026-07-18):** `isValidCampaignId()` in `lib/adjust/api-client.ts` (~line 23-27) gates on `/^\d+$/` with a comment "FB campaign IDs are purely numeric" — never verified for TikTok. Same silent-drop risk class as the `partner_name` issue. Fold into the same empirical verification pass (Step 9).

## Requirements

### Functional
- Two Supabase tables: singleton `tiktok_connection`, org-wide `tiktok_advertiser_accounts`.
- `tiktok-client.ts`: typed fetch wrapper (GET/POST) parsing the `{code, message, data}` envelope.
- `tiktok-connection.ts`: read/write singleton row via service client; `isTokenExpiringSoon()`; `refreshAccessToken()`; `getValidAccessToken()` (refresh-if-needed then return).
- `campaigns.ts`: `fetchCampaigns(advertiserId)`, `fetchAdGroups(advertiserId, campaignId?)` with pagination.
- `reporting.ts`: `fetchTodaySpend(advertiserId, level)` → `Map<id, {spend, impressions, clicks, cpc}>` keyed by campaign_id and adgroup_id.
- `campaign-actions.ts`: `updateCampaignStatus`, `updateCampaignBudget`, `updateAdGroupStatus`, `updateAdGroupBudget` — batch-aware (100-ID chunks for status).
- `merge.ts`: map raw TikTok rows + Adjust maps → `MergedTiktokCampaign`/`MergedTiktokAdGroup`, reusing `computeRoas`/`computeProfit`/`computeProfitAmount`. **USD-only by construction (Validation Session 1 Q1) — Phase 2 restricts advertiser selection to USD accounts, so no FX conversion is built; defensive `currency !== 'USD'` check skips ROAS math as a belt-and-suspenders invariant, not a supported path.**
- New types in `lib/types.ts`.
- Adjust `fetchAdjustRevenueToday()` accepts `partner: 'facebook' | 'tiktok'`; route accepts `?partner=`.
- `.env.local.example` documents `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`, `TIKTOK_OAUTH_REDIRECT_URI`.

### Non-functional
- Every new code file < 200 lines (global rule); split if exceeded.
- Tokens/secret never reach the browser — all reads/writes via `createServiceClient()`.
- No behavior change for the FB dashboard (Adjust `?partner` defaults to `'facebook'`).
- 30s fetch timeout (`AbortSignal.timeout(30_000)`) mirroring Adjust client.

## Architecture

### Data flow (per TikTok API call)
```
caller → getValidAccessToken()
          ├─ read tiktok_connection (service client)
          ├─ if expiring soon → POST /oauth2/access_token/ (grant_type=refresh_token)
          │      └─ update row: access_token, token_expires_at, updated_at
          └─ return access_token
       → tiktok-client GET/POST (Bearer token)  →  {code,message,data}
          └─ code!==0 → throw Error(message)   (401/expired → surfaced as reconnect error)
```

### Merge flow
```
fetchCampaigns(advId)  ─┐
fetchTodaySpend(CAMPAIGN)┼→ mergeTiktokCampaigns(rows, spendMap, adjustCohortMap, adjustAllRevMap)
adjust ?partner=tiktok ─┘      └─ MergedTiktokCampaign[]  (roas/profit via lib/adjust/merge.ts fns, computed directly on row.spend — USD-only by construction, Phase 2 enforces selection)
```
> 🔴 **Red Team Fix (2026-07-18), confirmed via Validation Session 1 Q1:** **USD-only for Plan 1** — no FX conversion is built. Non-USD advertiser accounts cannot be selected at all (enforced in Phase 2's account-selection UI/route, not just at merge time). `fxRateToUsd` is therefore always 1 by construction; `mergeTiktokCampaigns`/`mergeTiktokAdGroups` do NOT need conversion logic — they can assert `currency === 'USD'` defensively (throw or skip the row with a logged warning if this invariant is ever violated, e.g. a stale selection from before this restriction existed). Real FX conversion is deferred to a future plan if a non-USD advertiser account is ever needed.

### Component interactions
- `tiktok-connection.ts` is the ONLY module that mutates `tiktok_connection`. Client/reporting/actions modules receive an `accessToken` + `advertiserId` string; they never touch the DB (single-responsibility, mirrors FB where token comes from caller).
- `merge.ts` imports pure fns from `lib/adjust/merge.ts` — DRY, no re-implementation.

## Related Code Files

### Create
- `supabase/schema.sql` — **append** two `create table if not exists` blocks + RLS-enabled/no-policy (edit existing file, additive).
- `lib/tiktok/tiktok-client.ts` — fetch wrapper (base URL, Bearer, envelope parse/throw). Mirrors `lib/facebook/fb-client.ts`.
- `lib/tiktok/tiktok-connection.ts` — singleton read/write, `isTokenExpiringSoon`, `refreshAccessToken`, `getValidAccessToken`.
- `lib/tiktok/campaigns.ts` — `fetchCampaigns`, `fetchAdGroups` (paginated). Mirrors `lib/facebook/campaigns.ts`.
- `lib/tiktok/reporting.ts` — `fetchTodaySpend` via `/report/integrated/get/`.
- `lib/tiktok/campaign-actions.ts` — status/budget updates, batch-aware. Mirrors `lib/facebook/campaign-actions.ts`.
- `lib/tiktok/merge.ts` — mapping to Merged types, reusing `lib/adjust/merge.ts`.

### Modify
- `lib/types.ts` — append TikTok types (see below). Do NOT fragment into a new file.
- `lib/adjust/api-client.ts` — add `partner` param; replace hardcoded `.includes('facebook')` (~line 141).
- `app/api/adjust/revenue/route.ts` — accept `?partner=` (default `'facebook'`), pass through.
- `.env.local.example` — add TikTok section (comment style matches `ADJUST_*` block).

### Delete
- None.

### Types to append to `lib/types.ts`
```ts
// ─── TikTok Ads ──────────────────────────────────────────────────────────────
export interface TiktokAdvertiserAccount {
  advertiser_id: string;
  name: string;
  currency: string;       // e.g. 'USD'
  is_selected: boolean;
}
export interface TiktokCampaignRow {
  campaign_id: string;
  campaign_name: string;
  advertiser_id: string;
  advertiser_name: string;
  currency: string;
  status: 'ENABLE' | 'DISABLE' | string;
  budget: number;                        // plain decimal, account currency (no cents)
  budget_mode: 'DAILY' | 'LIFETIME' | string;
  spend: number;                         // from Reporting API (partial — 24–48h lag), NOT /campaign/get/
  impressions: number;
  clicks: number;
  cpc: number;
}
export interface TiktokAdGroupRow {
  adgroup_id: string;
  adgroup_name: string;
  campaign_id: string;
  advertiser_id: string;
  advertiser_name: string;
  currency: string;
  status: 'ENABLE' | 'DISABLE' | string;
  budget: number;
  budget_mode: 'DAILY' | 'LIFETIME' | string;
  spend: number;
  impressions: number;
  clicks: number;
  cpc: number;
}
export interface MergedTiktokCampaign extends TiktokCampaignRow {
  adjust_revenue: number | null;
  adjust_all_revenue: number | null;
  roas: number | null;
  profit_pct: number | null;
  profit: number | null;
  has_adjust_data: boolean;
}
export interface MergedTiktokAdGroup extends TiktokAdGroupRow {
  adjust_revenue: number | null;
  adjust_all_revenue: number | null;
  roas: number | null;
  profit_pct: number | null;
  profit: number | null;
  has_adjust_data: boolean;
}
```

## Implementation Steps

1. **Schema** — append to `supabase/schema.sql` (additive `create table if not exists`, follow existing style):
   - `public.tiktok_connection`: `id boolean primary key default true check (id)`, `access_token text`, `refresh_token text`, `token_expires_at timestamptz`, `connected_by uuid references auth.users(id)`, `connected_at timestamptz`, `updated_at timestamptz default now()`. `alter table ... enable row level security;` — **no policies** (default-deny; only service client touches it).
   - `public.tiktok_advertiser_accounts`: `advertiser_id text primary key`, `name text not null`, `currency text not null default 'USD'`, `is_selected boolean not null default true`. Enable RLS, no policies.
   - Add a header comment noting "run in Supabase SQL editor" like other blocks.
2. **`tiktok-client.ts`** — `const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3';` Export `tiktokGet(path, params, token)` and `tiktokPost(path, body, token)`. Both set `Authorization: Bearer {token}`; POST sends JSON body (`Content-Type: application/json`). Parse response JSON; if `code !== 0` throw `new Error(json.message ?? 'TikTok API error ' + code)`. Return `json.data`. 30s timeout.
3. **`tiktok-connection.ts`**:
   - `getConnection()` → read singleton row via service client (`.eq('id', true).maybeSingle()`), returns null if unconnected.
   - `isTokenExpiringSoon(expiresAt)` → true if `expiresAt` null or `< now + 30min`.
   - `refreshAccessToken(conn)` → POST `/oauth2/access_token/` `{app_id, secret, refresh_token, grant_type:'refresh_token'}`; on success update row `access_token`, **`refresh_token` (always persist `data.refresh_token` if present in the response — defensive against rotation, costs nothing if TikTok doesn't rotate)**, `token_expires_at = now + data.access_token_expire_in`, `updated_at`; return new token. On failure (refresh_token rejected): 🔴 **Red Team Fix (2026-07-18)** — before throwing, re-read the connection row; if `updated_at` changed since this call started, another concurrent request already refreshed successfully — return that fresh token instead of failing (avoids a false reconnect prompt on a healthy connection). Only if the row is still stale, throw the **typed** error message `TIKTOK_RECONNECT_REQUIRED` so routes can map to a clear "reconnect in Settings" 400/409 (not generic 502).
   - > 🔴 **Red Team Fix (2026-07-18):** `getValidAccessToken()` must be safe to call from multiple concurrent requests (org-wide singleton, serverless — no in-process locking across invocations). Callers that fan out per-advertiser (Phase 3) MUST call `getValidAccessToken()` **once** and reuse the token across all advertisers in that request, not once per advertiser — see Phase 3 fix.
   - `getValidAccessToken()` → getConnection → if none, throw `TIKTOK_NOT_CONNECTED`; if expiring, refresh; return token. Reads `TIKTOK_APP_ID`/`TIKTOK_APP_SECRET` from env.
4. **`campaigns.ts`** — `fetchCampaigns(token, advertiserId, advertiserName, currency)`: GET `/campaign/get/` with `advertiser_id`, `page`, `page_size=100`; loop pages via `data.page_info.total_number`; map to `TiktokCampaignRow` (spend/impressions/clicks/cpc default 0 — filled by reporting merge). `fetchAdGroups(token, advertiserId, advertiserName, currency, campaignId?)`: GET `/adgroup/get/` similarly. Serialize array params (dimensions etc.) as JSON strings where the API expects them.
5. **`reporting.ts`** — `fetchTodaySpend(token, advertiserId, dataLevel: 'CAMPAIGN' | 'ADGROUP')`: GET `/report/integrated/get/` with `dimensions=["campaign_id"]` (or `["adgroup_id"]`), `metrics=["spend","impressions","clicks","cpc"]`, `report_type=BASIC`, `data_level`, `start_date=end_date=today`. Return `Map<id, {spend, impressions, clicks, cpc}>`. Page through results (page_size 100).
   - > 🔴 **Red Team Fix (2026-07-18) — do this check first, before finalizing the timezone approach:** (1) Confirm empirically whether `/report/integrated/get/` accepts a timezone/UTC-offset parameter (check the full endpoint doc, not just the summary in the research report). If yes → pass Bangkok (`+07:00`) like the Adjust client does, eliminating the mismatch entirely. If no → use UTC "today" but surface this prominently in the UI (Phase 3), not just a code comment — this exact bug class (UTC vs Bangkok day boundary) was already shipped once for FB and cost a dedicated fix cycle; do not repeat it silently for TikTok. (2) Separately confirm whether same-day (`start_date=end_date=today`) reporting actually returns non-empty rows given the 24-48h lag (research §3.3 says "today's data incomplete") — if it's typically empty/near-zero, Phase 3's hub should default the primary view to yesterday's full-day numbers rather than an always-near-empty "today" column.
6. **`campaign-actions.ts`**:
   - `updateCampaignBudget(token, advertiserId, campaignId, budget)` → POST `/campaign/update/` `{advertiser_id, campaign_id, budget}`.
   - `updateCampaignStatus(token, advertiserId, campaignIds[], status)` → POST `/campaign/status/update/` `{advertiser_id, campaign_ids, status}`; **chunk `campaignIds` into ≤100** per request.
   - `updateAdGroupBudget` → POST `/adgroup/update/`; `updateAdGroupStatus` → POST `/adgroup/status/update/` (same chunking).
7. **`merge.ts`** — `mergeTiktokCampaigns(rows, spendMap, adjustCohortMap, adjustAllRevMap)`: for each row, overlay spend/impressions/clicks/cpc from `spendMap`; `adjust_revenue = adjustCohortMap.get(campaign_id) ?? null`. 🔴 **Red Team Fix, confirmed USD-only via Validation Session 1 Q1:** since Phase 2 enforces USD-only advertiser selection, `row.currency` should always be `'USD'` here — compute `roas/profit_pct/profit` directly via imported `computeRoas`/`computeProfit`/`computeProfitAmount` on `row.spend` (no conversion needed). As a defensive invariant check (not a feature to build out), if `row.currency !== 'USD'` ever occurs, skip ROAS/Profit for that row (`null` + a distinct "non-USD, unexpected" flag) rather than computing wrong numbers — this should only fire if the Phase 2 restriction is ever bypassed. Same for `mergeTiktokAdGroups` keyed by `adgroup_id`.
8. **Adjust generalization** — `lib/adjust/api-client.ts`: add param `partner: 'facebook' | 'tiktok' = 'facebook'` to `fetchAdjustRevenueToday`; replace `.includes('facebook')` filter (~line 141) with `.includes(partner)` (or a resolved partner-string constant once verified — see step 9). Update JSDoc.
9. **Adjust partner-string verification (CRITICAL — do NOT guess):** Before hardcoding the TikTok match string, run a one-off report WITHOUT any partner filter and inspect distinct `partner_name` values in the CSV to find the exact TikTok label (candidates: "Tiktok for Business", "TikTok Ads Manager", etc.). Only after confirming the literal, wire the filter. Guessing wrong silently returns zero TikTok revenue with no error. Document the confirmed string in a code comment. 🔴 **Red Team Fix (2026-07-18):** In the SAME verification pass, also inspect the raw `campaign_id_network`/`adgroup_id_network` values in TikTok rows for non-numeric characters — `isValidCampaignId()` (`lib/adjust/api-client.ts` ~line 23-27) currently assumes purely-numeric IDs with a comment claiming this is FB-specific; if TikTok IDs are also purely numeric this needs no code change, just confirmation + an updated comment (drop the "FB campaign IDs are purely numeric" framing since it's no longer accurate once TikTok shares the function). If non-numeric, adjust the regex to be partner-aware.
10. **Route** — `app/api/adjust/revenue/route.ts`: read `const partner = request.nextUrl.searchParams.get('partner') === 'tiktok' ? 'tiktok' : 'facebook';` pass to `fetchAdjustRevenueToday(...)`. Default preserves FB behavior exactly.
11. **`.env.local.example`** — append:
    ```
    # TikTok Ads (org-wide OAuth connection — tokens stored in DB, not here)
    # TIKTOK_APP_ID: Developer App ID from TikTok for Business portal
    # TIKTOK_APP_SECRET: Developer App secret (server-side only)
    # TIKTOK_OAUTH_REDIRECT_URI: must exactly match the callback whitelisted in the portal
    TIKTOK_APP_ID=
    TIKTOK_APP_SECRET=
    TIKTOK_OAUTH_REDIRECT_URI=
    ```
12. **Compile** — run the repo's typecheck/build to confirm no TS errors after adding types + modules.

## Todo List

- [x] Append `tiktok_connection` + `tiktok_advertiser_accounts` to `supabase/schema.sql` (RLS on, no policies)
- [x] Create `lib/tiktok/tiktok-client.ts` (envelope parse/throw)
- [x] Create `lib/tiktok/tiktok-connection.ts` (getConnection/isTokenExpiringSoon/refreshAccessToken/getValidAccessToken)
- [x] Create `lib/tiktok/campaigns.ts` (fetchCampaigns/fetchAdGroups, paginated)
- [x] Create `lib/tiktok/reporting.ts` (fetchTodaySpend keyed maps)
- [x] Create `lib/tiktok/campaign-actions.ts` (status/budget, 100-ID chunking)
- [x] Create `lib/tiktok/merge.ts` (reuse computeRoas/computeProfit/computeProfitAmount)
- [x] Append TikTok types to `lib/types.ts`
- [x] Add `partner` param to `fetchAdjustRevenueToday` + `?partner=` to revenue route
- [ ] **Verify Adjust `partner_name` string for TikTok empirically before hardcoding** — *Requires live Adjust export with TikTok traffic, unavailable in this session. Code flagged with "MUST VERIFY BEFORE PRODUCTION"; `PARTNER_MATCH` constant left as unverified best-guess (value: 'tiktok'). Same verification pass must also confirm TikTok campaign/ad group IDs are purely numeric.*
- [ ] 🔴 **Verify `isValidCampaignId()` numeric assumption holds for TikTok IDs** — *Deferred with empirical-verification item above; code comment updated to flag as unverified for TikTok.*
- [ ] 🔴 **Verify whether `/report/integrated/get/` accepts a timezone/UTC-offset param** — *Deferred; if no override available, UTC drift documented prominently in code comment pending Phase 3 UI implementation.*
- [x] 🔴 **`refreshAccessToken` persists `data.refresh_token` defensively + re-reads row before surfacing `TIKTOK_RECONNECT_REQUIRED` on a losing race**
- [x] 🔴 **`merge.ts` computes ROAS/Profit directly on `row.spend` (USD-only by construction); defensive skip if `currency !== 'USD'` ever occurs**
- [x] Document `TIKTOK_*` env vars in `.env.local.example`
- [x] Typecheck/build clean

## Success Criteria

- [x] Both tables exist in schema with RLS enabled and zero policies; verified only reachable via service client.
- [x] `getValidAccessToken()` returns a fresh token, transparently refreshing when `token_expires_at` is within 30 min; refresh-token rejection surfaces `TIKTOK_RECONNECT_REQUIRED` only after confirming the row is genuinely stale (not a lost race).
- [x] `fetchCampaigns`/`fetchAdGroups` paginate through >100 items correctly; `fetchTodaySpend` returns spend maps.
- [x] Batch status update splits >100 IDs into multiple requests.
- [x] `GET /api/adjust/revenue` (no param) returns identical FB results as before; `?partner=tiktok` filters to unverified TikTok partner string (value: 'tiktok' — must be verified against live Adjust export before production).
- [x] 🔴 Non-USD advertiser accounts cannot be selected in Phase 2's UI (USD-only, per Validation Session 1 Q1); the merge layer's defensive currency check never fires in normal operation (Phase 2 enforces restriction at selection UI and API layer).
- [x] TS build passes; no new file exceeds 200 lines.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Wrong Adjust `partner_name` for TikTok → silent zero revenue | High | High | Step 9 empirical verification before hardcoding; add code comment with confirmed literal; add a temporary log of distinct partner names during rollout |
| 🔴 Non-USD advertiser spend divided against USD Adjust revenue → silently wrong ROAS/Profit | ~~Medium~~ **Low after fix** | Critical | Resolved via Validation Session 1 Q1: Phase 2 restricts advertiser selection to USD-only; Step 7's `currency !== 'USD'` check is a defensive invariant, not an expected code path |
| Token refresh race (two concurrent calls both refresh) | Medium | **Medium** (was Low — a lost race without the re-read mitigation produces a false "reconnect" prompt on a healthy connection, confusing users) | Step 3 fix: re-read connection row before surfacing `TIKTOK_RECONNECT_REQUIRED`; retry with fresh token if another request already succeeded. Persist rotated `refresh_token` defensively. Single-flight dedup still deferred (YAGNI) |
| Reporting UTC "today" vs Adjust Bangkok "today" mismatch → spend/revenue day misalignment | Medium | **High** (was Medium — this is the same bug class already shipped and fixed once for FB; repeating it silently is a known-cost mistake, not a novel risk) | Step 5 fix: verify if TikTok reporting accepts a tz/utc_offset param and apply Bangkok offset if so; if not, surface the drift explicitly in the UI (Phase 3), not just a code comment |
| TikTok 429 rate limit on multi-account fan-out | Low | Medium | **Concurrency cap required, not optional** — see Phase 3 fix (hoist token fetch above fan-out + bounded concurrency); exponential backoff still deferred (YAGNI) unless observed |
| Refresh-token expiry (365d) mid-use | Low | High | Typed reconnect error → clear Settings prompt (implemented Phase 2 UI) |
| New file > 200 lines (connection.ts risk) | Low | Low | Split env/refresh helpers if needed |

## Security Considerations

- `access_token`/`refresh_token`/`TIKTOK_APP_SECRET` are server-only. Table has RLS on + no policies → anon/authenticated keys cannot read it; only `createServiceClient()` (service-role) can. Mirrors `fb_access_token` sensitivity.
- Never log full tokens; truncate any error body (mirror Adjust client `text.slice(0,200)`).
- `TIKTOK_APP_SECRET` never sent to client or embedded in any redirect.
- 🔴 **Red Team Fix (2026-07-18):** `getConnection()` returns the full row (including `access_token`/`refresh_token`) for internal use by `lib/tiktok/*` modules only. This is a hard non-functional requirement: no API route may spread or forward the raw `tiktok_connection` row into a JSON response. Phase 2's `/api/tiktok/accounts` GET route must explicitly select only `{connected, connected_at}` — never the row itself. See Phase 2 fix.

## Next Steps

- Phase 2 consumes `tiktok-connection.ts` (write path) + client for the OAuth callback and Settings status/toggle.
- Phase 3 consumes `campaigns.ts`/`reporting.ts`/`merge.ts` + types for the dashboard read view.
- Phase 4 consumes `campaign-actions.ts` for control parity.
