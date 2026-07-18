# Phase 2 — OAuth Connect Flow + Settings UI

## Context Links

- Plan overview: [plan.md](./plan.md)
- Depends on: [Phase 1](./phase-01-tiktok-api-client-and-database-schema.md) (connection table + client)
- Research: [TikTok Auth](../reports/researcher-260718-0920-tiktok-api-auth-control.md) (§1.1–1.3, §5)
- Mirror sources: `lib/auth-guards.ts` (`requireRole`), `app/api/settings/route.ts`, `app/settings/page.tsx`, `lib/supabase/server.ts`

## Overview

- **Priority:** P1
- **Status:** Complete (2026-07-18, verified via code review + testing)
- **Estimate:** ~3h
- **Scope:** Admin-gated OAuth connect flow (start → TikTok portal → callback → token save + advertiser upsert) and a Settings card to connect/disconnect + toggle which advertiser accounts are active (admin-only for connect/disconnect; admin+leader for toggle).

## Key Insights

- Authorize URL (research §1.1): `https://business-api.tiktok.com/portal/auth?app_id={TIKTOK_APP_ID}&state={STATE}&redirect_uri={TIKTOK_OAUTH_REDIRECT_URI}`. `state` = CSRF nonce.
- Callback (research §1.2): `GET {redirect_uri}?auth_code={AUTH_CODE}&state={STATE}`. Exchange (§1.3): POST `/oauth2/access_token/` `{app_id, secret, auth_code, grant_type:'authorization_code'}` → `{access_token, refresh_token, access_token_expire_in, advertiser_ids[], scope[]}`.
- `advertiser_ids` array in the response is the account list — no enumeration endpoint. Upsert each into `tiktok_advertiser_accounts`. (Advertiser display `name`/`currency` are NOT in the token response — fetch via `/advertiser/info/` per advertiser_id, or store id-as-name placeholder and enrich lazily; see Steps.)
- Org-wide model: connection is a **singleton**; re-authorizing overwrites it — 🔴 gated to `['admin']` only (see fix below; original draft said `['admin','leader']`, corrected by red team + confirmed in Validation Session 1 Q2).
- CSRF `state` must be verified in the callback. Store the nonce in a short-lived, httpOnly cookie set by `oauth/start` and compare in `oauth/callback` (stateless, no DB needed).
- > 🔴 **Red Team Fix (2026-07-18):** "mirrors existing RBAC" was wrong — re-checked the codebase's actual convention: `app/api/admin/*` routes (genuinely global/org-wide mutations) are `admin`-only; `app/api/leader/*` routes are scoped to *the leader's own team*. Rebinding the org's single TikTok connection to a (possibly different) TikTok Business account is a global action with no team scoping, so by the codebase's own convention it should be **`admin`-only**, not `admin`+`leader`. A malicious/compromised `leader` account re-running OAuth connect could otherwise silently hijack the org's entire TikTok integration (every user's data + every user's control actions per Phase 4) with no confirmation and no audit trail. **Revised gating (see Requirements/Steps below): `oauth/start`/`oauth/callback`/disconnect = `admin`-only. Advertiser `is_selected` toggling (reversible, lower-risk, day-to-day) stays `admin`+`leader`.**
- > 🔴 **Red Team Fix (2026-07-18):** Disconnect only deletes the local DB row — it never revokes the token at TikTok. If the shared token ever leaked (logs, backups, a departing admin), disconnect gives a false sense of security while the credential stays valid at TikTok for up to 365 days. Verify whether TikTok's API exposes a revocation/deauthorization endpoint; call it on disconnect if so. If no such endpoint exists, the disconnect UI must say so explicitly ("Local connection removed. TikTok-side token remains valid until natural expiry — revoke access from the TikTok Business Center if compromised.") rather than implying a clean cutoff.

## Requirements

### Functional
- `GET /api/tiktok/oauth/start` — 🔴 **`admin`-only** (Red Team Fix); generates `state`, sets httpOnly cookie, 302-redirects to the TikTok authorize URL.
- `GET /api/tiktok/oauth/callback` — 🔴 **`admin`-only**; validates `state` vs cookie; exchanges `auth_code`; saves `tiktok_connection` (via Phase 1 `tiktok-connection.ts`); upserts `tiktok_advertiser_accounts` from `advertiser_ids` **preserving existing `is_selected` for advertisers already present, and removing rows no longer in the new `advertiser_ids` set** (Red Team Fix — see below); redirects to `/settings?tiktok=connected` (or `?tiktok=error`).
- `GET /api/tiktok/accounts` — `admin`+`leader`; returns connection status (`connected`, `connected_at`) **only** — 🔴 never the raw `tiktok_connection` row (no token fields in the response) — plus advertiser list. `PATCH` — `admin`+`leader` toggles `is_selected` per advertiser; 🔴 **rejects (400) any attempt to set `is_selected=true` on a non-`USD` currency advertiser** (Validation Session 1 Q1 — USD-only for Plan 1, no FX conversion built); disconnect action is 🔴 **`admin`-only**, always clears both the connection row AND the advertiser accounts table (not "optional") and attempts token revocation at TikTok first if an endpoint exists.
- Settings UI card — connect/disconnect button (admin-only) + advertiser checklist (admin/leader can toggle); visible to admin/leader; shows "connected / not connected" + manual-prereq note.

### Non-functional
- Files < 200 lines. Settings card added inline to `app/settings/page.tsx` (already ~230 lines) OR extracted to a small `app/settings/tiktok-connection-card.tsx` component — **planner recommends extraction** to keep `page.tsx` under budget and isolate TikTok logic.
- Secret never leaves server; token save via service client only.

## Architecture

### OAuth data flow
```
[admin only] Settings "Connect TikTok"
  → GET /api/tiktok/oauth/start   (requireRole admin — 🔴 Red Team Fix, was admin|leader)
       ├─ state = randomUUID(); Set-Cookie tiktok_oauth_state (httpOnly, 10min)
       └─ 302 → business-api.tiktok.com/portal/auth?app_id&state&redirect_uri
  → [TikTok portal] user authorizes
  → GET /api/tiktok/oauth/callback?auth_code&state   (requireRole admin — 🔴 Red Team Fix)
       ├─ verify state == cookie   (else 400)
       ├─ POST /oauth2/access_token/ (authorization_code) → tokens + advertiser_ids
       ├─ saveConnection({access_token, refresh_token, token_expires_at=now+expire_in, connected_by, connected_at})
       ├─ upsert tiktok_advertiser_accounts: for each advertiser_id in response →
       │      insert new rows with is_selected=true; for EXISTING rows (already in table), preserve current is_selected (🔴 Red Team Fix — do not overwrite)
       ├─ 🔴 delete tiktok_advertiser_accounts rows whose advertiser_id is NOT in the new advertiser_ids set (stale-row cleanup)
       └─ 302 → /settings?tiktok=connected
```

### Settings status/toggle flow
```
Settings card mount → GET /api/tiktok/accounts → {connected, connected_at, accounts[]}   (🔴 never access_token/refresh_token)
toggle checkbox (admin|leader) → PATCH /api/tiktok/accounts {advertiser_id, is_selected}
disconnect (admin only — 🔴 Red Team Fix) → PATCH /api/tiktok/accounts {action:'disconnect'}
   → 🔴 attempt TikTok token revocation endpoint if one exists (verify during implementation)
   → delete connection row AND delete all tiktok_advertiser_accounts rows (🔴 always, not "optionally")
```

## Related Code Files

### Create
- `app/api/tiktok/oauth/start/route.ts` — GET, role-gated, build+redirect authorize URL, set state cookie.
- `app/api/tiktok/oauth/callback/route.ts` — GET, validate state, exchange, save, upsert, redirect.
- `app/api/tiktok/accounts/route.ts` — GET status+list; PATCH toggle/disconnect. Mirrors `app/api/settings/route.ts` shape.
- `app/settings/tiktok-connection-card.tsx` — client component: connect/disconnect + advertiser checklist (extracted; keeps `page.tsx` lean).

### Modify
- `app/settings/page.tsx` — render `<TiktokConnectionCard role={role} />` below the FB card; pass role (add `role` to the `/api/settings` GET consumer — route already returns `role`).
- `lib/tiktok/tiktok-connection.ts` (Phase 1) — add `saveConnection(...)` + `deleteConnection()` write helpers if not already present.

### Delete
- None.

## Implementation Steps

1. **`oauth/start`** — 🔴 `requireRole(user.id, ['admin'])` (Red Team Fix, was `['admin','leader']`); if denied return the Response. Read `TIKTOK_APP_ID`, `TIKTOK_OAUTH_REDIRECT_URI` (400 if unset). `const state = crypto.randomUUID();` set cookie `tiktok_oauth_state` (httpOnly, secure, sameSite lax, maxAge 600). Build URL `https://business-api.tiktok.com/portal/auth?app_id=...&state=...&redirect_uri=...` (encode redirect_uri). Return `Response.redirect(url, 302)`.
2. **`oauth/callback`** — 🔴 `requireRole(user.id, ['admin'])` (Red Team Fix). Read `auth_code`, `state` from query; read cookie; if mismatch/missing → redirect `/settings?tiktok=error&reason=state`. Call token exchange (reuse a `tiktok-connection.ts` helper `exchangeAuthCode(authCode)` that POSTs `/oauth2/access_token/`). On success: `saveConnection(...)` with `connected_by = user.id`, `token_expires_at = new Date(Date.now() + data.access_token_expire_in*1000)`, and 🔴 persist `data.refresh_token` (see Phase 1 fix). For each `advertiser_ids[i]`: fetch name/currency via `/advertiser/info/` (best-effort; fallback name = advertiser_id, currency = 'USD') and upsert into `tiktok_advertiser_accounts` (`onConflict: 'advertiser_id'`, update only `name`/`currency` columns — 🔴 explicitly omit `is_selected` from the `DO UPDATE SET` clause so existing selections are preserved, resolving the plan's earlier self-contradiction between the architecture diagram and this step). 🔴 After the upsert loop, `DELETE FROM tiktok_advertiser_accounts WHERE advertiser_id NOT IN (new advertiser_ids)` — removes stale rows from a prior authorization under a different TikTok login. Clear the state cookie. Redirect `/settings?tiktok=connected`. On error redirect `/settings?tiktok=error`.
3. **`accounts` route** — GET: `requireRole` admin|leader; return `{connected: !!conn, connected_at, accounts}` — 🔴 explicitly `.select('connected_at')`-style field limiting in `getConnection()`'s caller here, or a dedicated `getConnectionStatus()` helper that never touches `access_token`/`refresh_token` columns; the route must not spread the raw connection row. PATCH: body `{action:'disconnect'}` → 🔴 `requireRole(['admin'])` only; attempt TikTok revocation (verify endpoint availability during implementation, else skip with a logged note); `deleteConnection()` **and** delete all `tiktok_advertiser_accounts` rows (always, not optional); else `{advertiser_id, is_selected}` (admin|leader) → update row. Validate inputs; 400 on bad body.
4. **`saveConnection`/`deleteConnection`** in `tiktok-connection.ts` — upsert singleton (`id=true`, `onConflict:'id'`), persisting `refresh_token` on every write; delete = `.delete().eq('id', true)`.
5. **`tiktok-connection-card.tsx`** — mirror `app/settings/page.tsx` account-list UI (checkbox rows, save). Show: connected badge + `connected_at`; "Connect TikTok" / "Disconnect" buttons 🔴 rendered only when `role === 'admin'` (Red Team Fix); advertiser checklist with toggle → PATCH, rendered when `role === 'admin' || role === 'leader'`. 🔴 Non-`USD` advertiser rows show their checkbox disabled with a "USD-only in Plan 1" tooltip (Validation Session 1 Q1) rather than being silently omitted from the list. `window.location.href = '/api/tiktok/oauth/start'` for connect. Read `?tiktok=connected|error` from `useSearchParams` to show a status banner. Card visible to admin/leader; connect/disconnect controls admin-only within it.
6. **OAuth scope check** — 🔴 **Red Team Fix (2026-07-18):** in step 2's callback handler, after token exchange, compare `data.scope` against the expected scope ID(s) requested in the Developer Portal (Unresolved Question #1). If a required scope is missing, redirect `/settings?tiktok=error&reason=scope` with a distinct message rather than saving a connection that will fail opaquely on first real API call.
6. **Wire into `page.tsx`** — after loading `/api/settings` (which returns `role`), render the card with `role`. Keep FB card unchanged.
7. **Manual prereq note (in-UI):** card shows helper text: "Callback URL `{origin}/api/tiktok/oauth/callback` must be whitelisted in the TikTok Developer Portal." So the admin can copy it.
8. **Compile** — typecheck/build.

## Todo List

- [x] `app/api/tiktok/oauth/start/route.ts` (🔴 admin-only, state cookie, redirect)
- [x] `app/api/tiktok/oauth/callback/route.ts` (state check, exchange, save incl. refresh_token, upsert accounts preserving is_selected, 🔴 delete stale rows, 🔴 scope check — empty REQUIRED_SCOPES list pending Developer Portal scope ID confirmation)
- [x] `saveConnection`/`deleteConnection`/`exchangeAuthCode` in `tiktok-connection.ts`
- [x] `app/api/tiktok/accounts/route.ts` (GET status+list — 🔴 never token fields; PATCH toggle admin|leader, 🔴 disconnect admin-only + always clears accounts + documents no revocation endpoint found)
- [x] `app/settings/tiktok-connection-card.tsx` (🔴 connect/disconnect admin-only, checklist toggle admin|leader, non-USD rows disabled with tooltip)
- [x] Render card in `app/settings/page.tsx`, pass role
- [x] In-UI callback-URL copy hint (manual whitelist prereq)
- [x] Typecheck/build clean

## Success Criteria

- [x] Admin can click Connect → authorize on TikTok → land back on `/settings?tiktok=connected` with a populated advertiser checklist.
- [x] 🔴 Staff AND leader roles cannot reach `oauth/start`/`oauth/callback`/disconnect (403); leader can still see the card and toggle advertiser selection; staff does not see the card at all.
- [x] `tiktok_connection` singleton row written with correct `token_expires_at` and `refresh_token` (persisted defensively on every exchange/refresh); new advertisers inserted with `is_selected=true`, existing ones keep their current selection; advertisers no longer in the token response are removed; empty advertiser_ids array treated as sync failure (does not wipe table).
- [x] Toggling an advertiser persists `is_selected` (admin+leader); disconnect (admin-only) removes the connection row AND the advertiser accounts table; revocation endpoint check deferred (none found in TikTok docs), UI discloses token remains valid at TikTok until natural expiry.
- [x] CSRF: mismatched/missing `state` is rejected with distinct `reason=state` error param.
- [x] 🔴 `GET /api/tiktok/accounts` response never contains `access_token`/`refresh_token` fields (uses `getConnectionStatus()` which selects only `connected_at`; verified in actual response shape).

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Callback URL not whitelisted in Portal (still `giftago.co`) → auth fails | High (until fixed) | High | Explicit manual prereq in plan + in-UI copy hint; blocks only live testing, not code review |
| `/advertiser/info/` shape/fields differ → missing name/currency | Medium | Low | Best-effort enrich; fallback id-as-name, 'USD'; enrichment can be re-run |
| Unknown required OAuth scope IDs → token grants insufficient scope | Medium | Medium | Request scopes in Portal per research §5 (undocumented — Unresolved); 🔴 `data.scope` check now implemented in Step 2/6, not just deferred to a risk-table note |
| State cookie blocked (SameSite on cross-site redirect) | Low | Medium | SameSite=lax works for top-level GET redirect back; test in staging |
| 🔴 `leader` account re-authorizes and hijacks the org-wide connection | ~~Low~~ **N/A after fix** | ~~Low~~ **N/A** | Resolved by restricting connect/disconnect to `admin`-only |
| 🔴 Token remains valid at TikTok after "disconnect" in-app | Medium | High | Attempt revocation endpoint on disconnect; if unavailable, disconnect UI explicitly states the token remains valid until natural expiry |
| 🔴 Re-auth silently resets advertiser selections or leaves stale rows | Medium | Medium | Upsert preserves `is_selected` for existing rows; stale rows (not in new `advertiser_ids`) are deleted |

## Security Considerations

- `oauth/start` + `oauth/callback` + disconnect: 🔴 `requireRole(['admin'])`. `accounts` GET/PATCH-toggle: `requireRole(['admin','leader'])`. (Red Team Fix — was uniformly `['admin','leader']`.)
- `state` nonce (httpOnly cookie) prevents CSRF on the callback.
- `auth_code`, tokens, `TIKTOK_APP_SECRET` handled server-side only; never rendered.
- Redirect targets are fixed internal paths (no open-redirect from user input).
- 🔴 **Red Team Fix (2026-07-18):** `/api/tiktok/accounts` GET must never serialize `access_token`/`refresh_token` into its response — enforced via explicit field selection, not just "don't do it by convention" (see Phase 1 Security Considerations).

## Next Steps

- Phase 3 reads selected advertisers from `tiktok_advertiser_accounts` (service client) in `dashboard/tiktok/page.tsx`.
- Live end-to-end test blocked until Portal callback URL whitelisted (manual).
