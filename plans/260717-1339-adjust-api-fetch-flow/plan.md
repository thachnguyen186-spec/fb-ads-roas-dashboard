# Switch Default Data Source to Adjust API (CSV as Fallback)

**Status:** Completed — pending Vercel env var setup for production.

## Context
User wants the tool's start screen to default to fetching Adjust revenue via API (manual button click) instead of requiring a CSV upload every time, while keeping CSV upload available as a fallback if the API fetch fails.

## Key Insight — the UI already exists
Research confirmed `app/dashboard/components/campaign-hub.tsx:649-686` **already implements exactly this flow**, gated behind a `hasAdjustToken` boolean:
- `hasAdjustToken === true` → shows a manual **"Fetch Today's Data from Adjust API"** button (not auto-triggered — confirmed only wired to `onClick`, never called on mount/effect) as the primary step-1 action, with CSV upload demoted into a collapsed `<details>/<summary>` "Use CSV instead (fallback)" block (hidden until clicked).
- `hasAdjustToken === false` → shows CSV upload directly (this is the state in the user's screenshot).

`hasAdjustToken` is computed in `app/dashboard/page.tsx:27` as `!!process.env.ADJUST_API_TOKEN && !!process.env.ADJUST_APP_TOKEN` — **both env vars are currently unset** in `.env.local`, which is why the screenshot shows CSV-only.

**So no frontend UI changes are needed.** The real blockers are backend/config, discovered during this session's Adjust API testing:
1. Env vars were never set.
2. `lib/adjust/api-client.ts`'s `fetchAdjustRevenueToday()` doesn't send `adjust_account_id__in` — confirmed via direct API testing that Adjust's Report Service API returns `"Invalid app tokens"` without it, because this Adjust login has access to multiple accounts and the token defaults to the wrong one. Adding `adjust_account_id__in=36177` fixed it (verified: returned real campaign data for TT019, TT018, etc.).
3. Requiring a manually-maintained `ADJUST_APP_TOKEN` env var (comma-separated list) covering ~20+ apps is an operational burden and doesn't scale as apps are added. Adjust's `filters_data?required_filters=apps&adjust_account_id__in=X` endpoint (also verified working) returns the full app list for the account — better to auto-discover app tokens dynamically when no explicit override is configured.

## Requirements
- Default start screen (when `hasAdjustToken` is properly configured): manual "Fetch Data" button, no auto-fetch on load, no CSV step shown by default.
- CSV upload remains available as a collapsed fallback (already implemented).
- Adjust API fetch must actually work: needs `adjust_account_id__in` wired through.
- Should not require manually maintaining a long list of app tokens — auto-discover via Adjust's `filters_data` endpoint when `ADJUST_APP_TOKEN` isn't explicitly set (keeps the option to override/restrict via env var if ever needed).
- Never log/expose the raw API token (existing pattern in api-client.ts already truncates error bodies — preserve this).

## Architecture
```
handleFetchFromApi() [unchanged, already manual-only]
  → GET /api/adjust/revenue
    → reads ADJUST_API_TOKEN + ADJUST_ACCOUNT_ID (required) + ADJUST_APP_TOKEN (optional) from env
    → fetchAdjustRevenueToday(token, accountId, appTokens, appFilter)
        → if appTokens is empty: fetchAdjustAppTokens(token, accountId) to auto-discover all apps for the account
        → calls csv_report with adjust_account_id__in=accountId + app_token[]=<discovered or configured tokens>
    → returns AdjustRow[] (same shape as CSV path — merge pipeline untouched)
```

## Related Code Files
**Modify:**
- `lib/adjust/api-client.ts` — add `accountId` param to `fetchAdjustRevenueToday`; add new `fetchAdjustAppTokens()` helper; auto-discover when `appTokens` is empty instead of throwing.
- `app/api/adjust/revenue/route.ts` — require `ADJUST_ACCOUNT_ID` env var, make `ADJUST_APP_TOKEN` optional, pass `accountId` through.
- `app/dashboard/page.tsx` — update `hasAdjustToken` to check `ADJUST_API_TOKEN` + `ADJUST_ACCOUNT_ID` (drop the `ADJUST_APP_TOKEN` requirement since it's now optional/auto-discovered).
- `.env.local` — add `ADJUST_API_TOKEN` and `ADJUST_ACCOUNT_ID=36177` (verified working values from this session's live testing). Leave `ADJUST_APP_TOKEN` unset so it auto-discovers all ~20+ apps.

**No changes needed:** `app/dashboard/components/campaign-hub.tsx`, `app/dashboard/components/adjust-csv-upload.tsx` — the desired UI flow already exists there.

**No new files** (YAGNI — the discovery helper is small enough to live in the existing `api-client.ts`).

## Implementation Steps
1. `lib/adjust/api-client.ts`:
   - Add `export async function fetchAdjustAppTokens(token: string, accountId: string): Promise<string[]>` — calls `GET filters_data?required_filters=apps&adjust_account_id__in={accountId}`, parses `{apps: [{id, ...}]}`, returns `apps.map(a => a.id)`. Throws with truncated error body on non-200 (same pattern as existing error handling).
   - Change `fetchAdjustRevenueToday(token, appTokens, appFilter)` signature to `fetchAdjustRevenueToday(token, accountId, appTokens, appFilter)`.
   - Replace the current `if (appTokens.length === 0) throw ...` with: if empty, `appTokens = await fetchAdjustAppTokens(token, accountId)`; if still empty after that, throw (genuinely no apps on the account).
   - Add `adjust_account_id__in: accountId` to the `URLSearchParams` built for the `csv_report` call.
2. `app/api/adjust/revenue/route.ts`:
   - Read `const accountId = process.env.ADJUST_ACCOUNT_ID;` — 400 if missing (`ADJUST_ACCOUNT_ID env variable not configured on server.`).
   - Change the `ADJUST_APP_TOKEN` block: no longer 400s when empty — just results in `appTokens = []`, passed through (triggers auto-discovery downstream).
   - Pass `accountId` into `fetchAdjustRevenueToday(token, accountId, appTokens, appFilter)`.
3. `app/dashboard/page.tsx:27`: `const hasAdjustToken = !!process.env.ADJUST_API_TOKEN && !!process.env.ADJUST_ACCOUNT_ID;`
4. `.env.local`: append
   ```
   ADJUST_API_TOKEN=3xqSpLSpFTPF_3RmaxxzBHofz7-JRT-BB9SjH121CDi7mzySWg
   ADJUST_ACCOUNT_ID=36177
   ```
5. Verify end-to-end via direct `curl`/script against the real route logic (simulate what the route does) before relying on dev-server browser testing (still blocked this session — no browser tooling, auth-gated dashboard).
6. Flag to user: same two env vars need to be added to Vercel's project env vars for production — I cannot do this myself (no Vercel dashboard access).

## Todo List
- [x] Add `fetchAdjustAppTokens()` helper in api-client.ts
- [x] Update `fetchAdjustRevenueToday()` signature + auto-discovery fallback + `adjust_account_id__in` param
- [x] Update `/api/adjust/revenue/route.ts` for `ADJUST_ACCOUNT_ID` (required) + optional `ADJUST_APP_TOKEN`
- [x] Update `hasAdjustToken` in `page.tsx`
- [x] Add env vars to `.env.local`
- [x] `next build` + `eslint` clean
- [x] Verify real data returns (curl-level, mirroring route logic) with account_id + auto-discovered app tokens
- [ ] Remind user to set the same env vars in Vercel for production

## Success Criteria
- With env vars set, dashboard start screen shows "Fetch Today's Data from Adjust API" button as the primary action (no CSV step visible by default).
- Clicking the button fetches real data (verified via curl equivalent of the route logic) across all apps on the account, not just a hardcoded subset.
- CSV upload still available, collapsed under "Use CSV instead (fallback)".
- `next build` + `eslint` pass clean.

## Risk Assessment
- Low-medium: touches a previously-broken, previously-untested code path (this route has never successfully returned real data before today). Mitigated by verifying the exact fixed query at the curl level (already done this session) before wiring it through the app layer.
- `ADJUST_ACCOUNT_ID` is a plaintext env var — consistent with how `ADJUST_API_TOKEN` is already handled (server-only, never sent to client per existing route design).

## Security Considerations
- Token stays server-side only (existing design — route never returns the token to the client, only `hasAdjustToken: boolean` and the resulting data rows).
- `.env.local` confirmed gitignored (`.env*` in `.gitignore`) — safe to write real credentials there.
- Error responses already truncate Adjust API error bodies to 200 chars to avoid leaking sensitive data in logs (existing pattern, preserved).

## Next Steps
1. **Verification approach:** Standalone script verified end-to-end logic (auto-discovered 15 apps, fetched 794 real campaign rows + 548 Facebook-attributed). Browser-level manual verification deferred (no browser automation available; dashboard requires Supabase auth).
2. **Outstanding:** Add `ADJUST_API_TOKEN` and `ADJUST_ACCOUNT_ID=36177` to Vercel project environment variables (user action — I lack Vercel access). Without these, production will revert to CSV-only fallback.
