# Code Review: TikTok Ads Tab Foundation — Phase 1 + Phase 2

Reviewed against `plans/260718-1343-tiktok-ads-tab-foundation/plan.md` (Red Team Review + Validation Log) and phase-01/phase-02 files. All 15 red-team findings and all 4 validation-interview decisions were traced to their implementation — every 🔴-marked fix is present and correct in code (details below, "Red-Team Fix Verification"). No re-flagging of already-resolved items. Findings below are genuinely new observations from this pass.

## Scope
- Files: 14 (7 new `lib/tiktok/*`, 3 new `app/api/tiktok/*` routes, 1 new settings card, 3 modified: `lib/types.ts`, `lib/adjust/api-client.ts`, `app/api/adjust/revenue/route.ts`, `app/settings/page.tsx`, `supabase/schema.sql`, `.env.local.example`)
- LOC: ~800 across `lib/tiktok/*` + routes + card, all individually under the 200-line rule (largest: `tiktok-connection.ts` 148, `tiktok-connection-card.tsx` 171)
- Known unresolved gaps (per task context, not re-flagged as defects): TikTok Reporting API UTC vs. Bangkok day-boundary drift (documented, UI surfacing deferred to Phase 3); no token-revocation endpoint on disconnect (UI discloses this); Adjust `partner_name`/numeric-ID assumptions for TikTok unverified (documented in code comments, correctly gated as MUST-VERIFY-BEFORE-PRODUCTION, not a code defect)

## Overall Assessment
Solid, disciplined implementation. Every one of the 15 red-team findings is visibly and correctly wired into the code, not just the plan prose — this is unusually thorough follow-through (verified line-by-line, see below). Conventions consistently mirror the FB-side files (`fb-client.ts` → `tiktok-client.ts`, `fb campaign-actions.ts` chunking style, `adjust/merge.ts` pure-function reuse). No unauthenticated or under-authorized path was found. No token/secret leak was found anywhere (grepped for `console.*` + token fields across `lib/tiktok/*` and `app/api/tiktok/*` — clean). Remaining issues are second-order correctness gaps in multi-step write sequences (no atomicity), not security holes.

## Red-Team Fix Verification (ground truth check, not re-flagged)
All confirmed present and correct in code:
1. Control-plane role gates — N/A yet (Phase 4 not built; `campaign-actions.ts` not wired to any route).
2. OAuth connect/callback/disconnect = admin-only — confirmed: `requireRole(user.id, ['admin'])` in `app/api/tiktok/oauth/start/route.ts:21`, `callback/route.ts:89`, `accounts/route.ts:70` (disconnect branch).
3. USD-only ROAS — confirmed: `lib/tiktok/merge.ts` computes `isUsd = merged.currency === 'USD'` and nulls roas/profit otherwise; `accounts/route.ts:84-94` rejects `is_selected=true` for non-USD at the API layer (not just UI); `tiktok-connection-card.tsx:149` disables the checkbox with a tooltip.
4. Refresh_token persisted defensively — confirmed: `tiktok-connection.ts:73` `if (data.refresh_token) row.refresh_token = data.refresh_token;`
5. Fan-out token reuse — N/A yet (Phase 3 not built); `getValidAccessToken()` doc comment correctly instructs future callers.
6. Reporting lag — documented in `reporting.ts` header comment; UI surfacing correctly deferred to Phase 3 per plan.
7. Dashboard read role check — N/A yet (Phase 3).
8. Disconnect token revocation — confirmed absent-by-design with UI disclosure (`accounts/route.ts:44-48` comment, `tiktok-connection-card.tsx:66-69` `window.confirm` text).
9. Advertiser hygiene — confirmed: `oauth/callback/route.ts` `syncAdvertiserAccounts()` upsert omits `is_selected` from the payload (preserves existing selection — verified this is safe with Supabase's PostgREST merge-duplicates upsert, which only SETs columns present in the payload, not a full-row replace) and separately deletes stale rows not in the new `advertiser_ids` set (lines 69-75).
10. UTC vs Bangkok reporting mismatch — documented prominently in `reporting.ts` module header; no tz/utc_offset override found for `/report/integrated/get/`, matches the "if not documented" fallback path.
11. Budget-minimum validation — N/A yet (Phase 4).
12. No access_token/refresh_token in API responses — confirmed: `getConnectionStatus()` explicitly `.select('connected_at')` only (`tiktok-connection.ts:44-53`); `accounts/route.ts` GET never touches `getConnection()` (the full-row internal function) — only `getConnectionStatus()`.
13. Campaign/adgroup ownership check — N/A yet (Phase 4).
14. Adjust numeric-ID assumption — comment updated correctly (`lib/adjust/api-client.ts:35-37`), drops FB-specific framing, flags unverified — matches spec, not a defect.
15. Bulk pause/enable partial-failure — N/A yet (Phase 4); chunking itself (`campaign-actions.ts` `chunk()`) is correct and ≤100-per-request.

## High Priority

### 1. `refreshAccessToken` conflates "TikTok rejected the refresh" with "our own DB write failed after a successful TikTok exchange"
`lib/tiktok/tiktok-connection.ts:113-134`. The race-guard re-read (`fresh.updated_at !== conn.updated_at`) only handles the case where a *different concurrent request* already refreshed successfully. It does not handle the case where *this same request's* `tiktokPost(...)` call to TikTok succeeds — potentially rotating/invalidating the old `refresh_token` at TikTok's end — but the subsequent `writeTokens(data, ...)` Supabase write then throws (transient DB error, RLS misconfig, etc.). In that scenario the catch block re-reads the row, finds it unchanged, and throws `TIKTOK_RECONNECT_REQUIRED` — even though TikTok didn't actually reject anything. Worse, if TikTok rotates the refresh token on use, the org has now lost both the old (invalidated) and new (never persisted) refresh_token, forcing a full re-authorization for what was really just a DB hiccup.
- **Fix:** in the `catch` block, distinguish "the `tiktokPost` call itself threw" (genuine TikTok-side rejection → race-guard logic as-is) from "the POST succeeded but `writeTokens` threw" (retry the write once with the in-memory `data` before giving up, or at minimum surface a distinct, non-"reconnect required" error so it isn't misdiagnosed as an expired refresh token).

### 2. No atomicity between `saveConnection` and `syncAdvertiserAccounts` in the OAuth callback
`app/api/tiktok/oauth/callback/route.ts:120-125`. Both calls share one try/catch redirecting to `?tiktok=error&reason=save` on failure. If `saveConnection` succeeds but `syncAdvertiserAccounts` throws (e.g. the upsert or stale-delete fails), the connection is already persisted (org is "connected") but the advertiser table sync did not complete — yet the admin is told the operation failed via the generic `save` error banner. A retry requires a brand-new `auth_code` (the old one is single-use), so the admin can't "just retry the sync step" — they'll re-run the whole OAuth dance against an already-connected org.
- **Fix:** at minimum, split the error `reason` so the redirect can distinguish "token save failed" (retry connect) from "advertiser sync failed but you're connected" (retry is just re-hitting a resync, not a fresh OAuth flow) — or wrap in a single transaction-like helper that rolls back `saveConnection` if `syncAdvertiserAccounts` fails.

## Medium Priority

### 3. Empty `advertiser_ids` in a successful token exchange silently wipes the entire advertiser table
`app/api/tiktok/oauth/callback/route.ts:53-76` (`syncAdvertiserAccounts`). The upsert is skipped when `advertiserIds.length === 0` (guarded), but the stale-row delete is unconditional — with an empty new set, every existing row is "stale" and gets deleted. If TikTok ever returns `code:0` with an empty/partial `advertiser_ids` (scope hiccup, temporarily unlinked ad account, API glitch), a routine re-authorization would silently clear every previously-selected advertiser account, while the UI only shows a "connected" success banner — no warning that account selections were wiped. This is a stronger version of red-team finding #9's mandate ("delete rows not in the new set") than was likely intended for the degenerate empty-array case.
- **Fix:** skip the stale-row delete entirely when `advertiserIds.length === 0` (treat as "TikTok gave us no info this time," not "TikTok says you now have zero accounts").

### 4. `handleDisconnect` is two sequential deletes with no rollback
`app/api/tiktok/accounts/route.ts:49-55`. `deleteConnection()` runs first; if the subsequent `tiktok_advertiser_accounts` delete then fails, the response is a 500, but the connection row is already gone while advertiser rows remain — an inconsistent "disconnected but stale advertiser rows still on file" state. Postgres deletes essentially never fail on their own, so likelihood is low, but there's no compensating action if it does.
- **Fix:** low-effort — swap the order (delete `tiktok_advertiser_accounts` first, `tiktok_connection` second) so a mid-failure leaves the org still "connected" (safer default than "disconnected with orphaned account rows"), or accept as-is given low likelihood.

## Low Priority / Informational

- **OAuth-denial UX**: if a TikTok user cancels/denies authorization at the portal, the redirect likely omits `auth_code` and may carry an `error` param instead of `state`. The current check (`!authCode || !state || ...`) routes this into the generic `reason=state` bucket → user sees "Connection request expired or was tampered with" instead of a clear "you denied access" message. Cosmetic.
- **Misleading 400 for a bogus `advertiser_id`**: PATCH `/api/tiktok/accounts` with `is_selected:true` and a nonexistent `advertiser_id` returns "Only USD advertiser accounts can be selected…" (because the currency lookup returns `undefined`, which fails the `=== 'USD'` check) rather than a 404. Cosmetic, no security impact (query is parameterized, no injection risk).
- **No runtime audit log on disconnect**: phase-02 Step 3 says "attempt revocation… else skip with a logged note." The code has a doc-comment but no `console.log`/`console.warn` at the point of actual disconnect. Since token revocation itself is a documented, deliberately-deferred gap (no endpoint found), this is purely a nice-to-have for an audit trail, not a defect.
- **`TiktokConnectionRow.token_expires_at`/`refresh_token` typed as non-nullable strings** (`tiktok-connection.ts:13-21`) but the DB columns have no `NOT NULL` constraint. Runtime code (`isTokenExpiringSoon`) already null-checks defensively, so this is a type-vs-schema looseness with no behavioral impact, not a bug.

## Security
No findings beyond what's covered in "Red-Team Fix Verification." Specifically verified and clean:
- `GET /api/tiktok/accounts` response shape traced end-to-end: `getConnectionStatus()` selects only `connected_at`; the advertiser query selects `advertiser_id,name,currency,is_selected` — no path to `access_token`/`refresh_token` reaching a JSON response.
- CSRF state-cookie: httpOnly, `secure` in production, `sameSite: lax`, 10-min TTL, single-use (deleted on every callback hit regardless of match outcome), rejected on missing/mismatched state.
- Verified Next.js cookie-mutation + `Response.redirect()` interaction against actual framework source (`node_modules/next/dist/server/route-modules/app-route/module.js`) given this repo's non-standard Next.js version — Next.js always re-wraps the returned Response to append pending cookie mutations regardless of whether `Response.redirect()` or `NextResponse.redirect()` was used, so the CSRF cookie flow works as written. (Saved to reviewer memory — worth checking source over docs for this repo's Next version generally.)
- No secrets/tokens found in any `console.*` call or error-message string across `lib/tiktok/*` and `app/api/tiktok/*`.
- Role gates cross-checked against `lib/auth-guards.ts` `requireRole` — matches the plan's final admin-only / admin+leader split exactly.

## Consistency with FB-side conventions
Matches closely: `tiktok-client.ts` mirrors `fb-client.ts`'s envelope/error pattern; `campaign-actions.ts` chunking mirrors the 100-ID batching intent (no FB equivalent needed since FB doesn't batch, but the pattern is idiomatic); `merge.ts` correctly reuses `computeRoas`/`computeProfit`/`computeProfitAmount` from `lib/adjust/merge.ts` (DRY, no reimplementation); `campaigns.ts` pagination loop is a reasonable, simpler analog (TikTok has no cents/VND-smallest-unit quirk, correctly not replicated).

## Task Completeness
Both phase files' Todo Lists are fully implementable from the code as written:
- Phase 1 todos: all done except the two explicitly-deferred empirical-verification items (Adjust partner_name, TikTok numeric-ID assumption) — correctly left as documented gaps, not silently skipped.
- Phase 2 todos: all done, including the in-UI callback-URL copy hint (`tiktok-connection-card.tsx:131-135`) and the OAuth scope check stub (`callback/route.ts` `REQUIRED_SCOPES`/`hasRequiredScopes`, correctly a no-op placeholder pending Developer Portal scope IDs).

Recommend marking Phase 1 and Phase 2 status `Complete` in `plan.md` (currently "Pending") once the two above high-priority items are triaged — neither blocks moving to Phase 3, since both are edge-case robustness gaps in already-narrow failure paths (concurrent DB failure during refresh; sync failure immediately after a successful exchange), not blockers to normal operation.

## Recommended Actions (priority order)
1. `refreshAccessToken`: distinguish TikTok-rejected vs. local-write-failed in the catch branch (High #1).
2. OAuth callback: give `syncAdvertiserAccounts` failures a distinct error reason from token-exchange failures, since the connection is already saved by that point (High #2).
3. `syncAdvertiserAccounts`: skip the stale-row delete when `advertiserIds` is empty (Medium #3).
4. `handleDisconnect`: reorder deletes so a mid-failure favors "still connected" over "disconnected with orphaned rows" (Medium #4).
5. Optional polish: distinguish OAuth-denial from state-mismatch in the callback UX; add a disconnect audit log line; 404 vs 400 for unknown `advertiser_id`.

## Unresolved Questions
- None blocking. The three known, task-disclosed gaps (UTC/Bangkok reporting drift, no revocation endpoint, unverified Adjust partner_name/ID-format for TikTok) remain exactly as scoped — confirmed not silently mishandled, just correctly deferred with prominent documentation.
