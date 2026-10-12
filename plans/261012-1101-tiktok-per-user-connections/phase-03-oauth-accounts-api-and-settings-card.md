# Phase 03 — OAuth flow, accounts API, Settings card (all roles, own connection)

## Context Links
- `app/api/tiktok/oauth/start/route.ts`, `app/api/tiktok/oauth/callback/route.ts`, `lib/tiktok/oauth-state.ts`
- `app/api/tiktok/accounts/route.ts`, `app/settings/page.tsx` (~line 223), `app/settings/tiktok-connection-card.tsx`
- Phase 2 signatures: [phase-02](./phase-02-per-user-connection-lib.md)

## Overview
- Priority: P1. Status: implemented, pending deploy test. Effort: 2h. Blocked by Phase 2.
- Remove admin/leader gates; every authenticated user connects/disconnects/selects/resyncs THEIR OWN connection only.

## Key Insights
- Old gates existed only because one token controlled the whole org (journal 20260718). Per-user tokens remove that risk class -> FB-style "own data" rule is sufficient.
- CSRF cookie flow already solid; harden by binding the state to the user who started it (cheap, prevents a session switch mid-flow from attaching tokens to a different app user).
- Next.js (this repo's version): `cookies()` is async and route `params` are Promises — already used correctly; consult `node_modules/next/dist/docs/` only if changing routing APIs (not planned).

## Requirements
- `GET /api/tiktok/oauth/start`: any authenticated user. Cookie value `${user.id}:${uuid}`; TikTok `state` param = uuid.
- `GET /api/tiktok/oauth/callback`: any authenticated user; verify cookie === `${user.id}:${state}`; `saveConnection(data, user.id)`; `syncUserAdvertisers(user.id, ids, token)`.
- `GET /api/tiktok/accounts`: any role -> `{ connected, connected_at, accounts }` for `user.id` only (never tokens).
- `PATCH /api/tiktok/accounts` (any role, own rows only):
  - `{advertiser_id, is_selected}` -> lookup + update with `.eq('user_id', user.id)`; USD-only gate kept.
  - `{action:'resync_names'}` -> `getValidAccessToken(user.id)` + `resyncUserAdvertiserNames(user.id, token)`.
  - `{action:'disconnect'}` -> delete own `tiktok_ad_accounts` rows, then `deleteConnection(user.id)`.
- Settings page renders card for every role.

## Architecture — data flow
```
Settings card ─ Connect ─> /oauth/start (cookie uid:nonce) ─> TikTok portal ─> /oauth/callback?auth_code&state
  callback: cookie==uid:state ? exchangeAuthCode -> saveConnection(uid) -> syncUserAdvertisers(uid) -> /settings?tiktok=connected
Settings card ─ GET/PATCH /api/tiktok/accounts ─> rows WHERE user_id = auth uid
```

## Related Code Files
- Modify: `lib/tiktok/oauth-state.ts` (add `buildOauthStateCookie(userId, nonce)` / `matchesOauthState(cookie, userId, state)`), `app/api/tiktok/oauth/start/route.ts`, `app/api/tiktok/oauth/callback/route.ts`, `app/api/tiktok/accounts/route.ts`, `app/settings/page.tsx`, `app/settings/tiktok-connection-card.tsx`
- Create / Delete: none

## Implementation Steps
1. `oauth-state.ts`: add the two helpers (string concat + strict equality; reject if cookie missing).
2. `oauth/start`: delete `requireRole`; set cookie via helper; update header comment.
3. `oauth/callback`: delete `requireRole` + local `syncAdvertiserAccounts`; use `matchesOauthState`; call `saveConnection(tokenData, user.id)` and `syncUserAdvertisers(user.id, …)`. Keep redirect/error reasons and REQUIRED_SCOPES unchanged. Update comments ("admin-only" -> "per-user").
4. `accounts/route.ts`: remove both `requireRole` calls and `handleResyncNames` body (now in lib); scope every query with `.eq('user_id', user.id)`; disconnect deletes `.eq('user_id', user.id)` (replaces `.neq('advertiser_id','')` which wiped the whole table). Response shapes unchanged.
5. `settings/page.tsx`: `<TiktokConnectionCard role={role} />` unconditionally.
6. `tiktok-connection-card.tsx`: prop `role: UserRole`; Connect/Disconnect shown for all roles; callback-URL hint stays admin-only; copy -> "Your personal TikTok connection. Accounts you authorize appear on your TikTok dashboard (visible to your leader/admin)."; disconnect confirm -> "removes YOUR connection and advertiser selections"; dashboard notice text no longer says "(admin only)" (that text lives in hub — Phase 5).
7. `npx tsc --noEmit` on touched files.

## Todo List
- [x] oauth-state helpers bound to user id
- [x] start/callback: remove role gates, per-user save + sync
- [x] accounts route: own-row scoping for GET/toggle/resync/disconnect
- [x] settings page renders card for all roles
- [x] card copy + controls for all roles

## Success Criteria
- Staff can connect; their rows appear only under their user_id.
- Disconnect by user A leaves user B's connection/rows (even same advertiser_id) intact.
- Callback with a cookie from another user id -> `?tiktok=error&reason=state`.

## Risk Assessment
| Risk | L x I | Mitigation |
|------|-------|-----------|
| Missed `.eq('user_id')` -> cross-user toggle/delete | M x H | Every query in accounts route reviewed; test 8 in Phase 7 |
| TikTok app restricted to app-owner accounts (dev mode) | M x H | Verify app status in TikTok Developer Portal before release (Unresolved Q1) |
| Old state cookie format in flight at deploy | L x L | Mismatch -> "state" error, user retries |

## Security Considerations
- No role gate needed: blast radius = requester's own token/rows.
- Error `detail` in redirect goes only to the same user; still truncated to 200 chars; tokens never in messages.

## Rollback
Revert commit; old tables still serve the old code.

## Next Steps
Phase 7 manual tests 1-8.
