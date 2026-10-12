# Phase 02 — Per-user connection lib

## Context Links
- `lib/tiktok/tiktok-connection.ts` (191 lines, has UNCOMMITTED long-term-token fix — keep it)
- `app/api/tiktok/oauth/callback/route.ts` (`syncAdvertiserAccounts` to extract)
- `app/api/tiktok/accounts/route.ts` (`handleResyncNames` to extract)
- `lib/auth-guards.ts` (`getVisibleUserIds`, `canViewAs` — reuse, no edits)

## Overview
- Priority: P1. Status: implemented, pending deploy test. Effort: 2h. Blocked by Phase 1.
- Re-key every connection function by `userId`; move advertiser-row sync into a shared user-scoped module; add one shared guard for control routes.

## Key Insights
- `tiktok-connection.ts` stays the ONLY module that reads `tiktok_connections` (token table). Everything else gets a bare token.
- Long-term tokens: keep `getValidAccessToken` rule "refresh only if `refresh_token` present AND expiring"; null expiry = never expiring.
- Callers in Phases 3-6 change signature; `npx tsc --noEmit` passes only once 2-6 are all in. Phase 2 gate = its own files type-check (`npx tsc --noEmit 2>&1 | grep lib/tiktok` empty).

## Requirements
Functional (new signatures):
```ts
// lib/tiktok/tiktok-connection.ts  (table: tiktok_connections, PK user_id)
getConnection(userId: string): Promise<TiktokConnectionRow | null>          // internal, has tokens
getConnectionStatus(userId: string): Promise<{ connected: boolean; connected_at: string | null }>
listConnectedUserIds(userIds: string[]): Promise<string[]>                   // selects user_id ONLY
saveConnection(data: TiktokTokenExchangeData, userId: string): Promise<void>
deleteConnection(userId: string): Promise<void>
refreshAccessToken(conn: TiktokConnectionRow): Promise<string>               // race guard re-reads by conn.user_id
getValidAccessToken(userId: string): Promise<string>                         // throws TIKTOK_NOT_CONNECTED / TIKTOK_RECONNECT_REQUIRED
describeAuthError(err): { status; message }                                  // unchanged
exchangeAuthCode(authCode)                                                   // unchanged

// lib/tiktok/advertiser-sync.ts (NEW; table tiktok_ad_accounts)
syncUserAdvertisers(userId: string, advertiserIds: string[], token: string): Promise<void>
resyncUserAdvertiserNames(userId: string, token: string): Promise<{ updated: number; total: number; errors: string[] }>

// lib/tiktok/control-guard.ts (NEW)
resolveOwnAdvertiserToken(userId: string, advertiserId: string): Promise<string | Response>
```
Non-functional: no token field ever selected outside `tiktok-connection.ts`; files < 200 lines.

## Architecture — data flow
```
route ── userId ──> getValidAccessToken(userId) ── select * from tiktok_connections where user_id ──> token
                                    └─ refresh_token && expiring ? refresh + upsert(onConflict user_id) : token
control route ──> resolveOwnAdvertiserToken(uid, adv)
                   ├─ tiktok_ad_accounts where advertiser_id=adv AND user_id=uid AND is_selected ─ none -> 403
                   └─ getValidAccessToken(uid) ─ error -> describeAuthError Response
OAuth callback ──> syncUserAdvertisers(uid, ids, token)
                   ├─ upsert rows {advertiser_id, user_id, name, currency} onConflict 'advertiser_id,user_id'
                   └─ delete rows where user_id=uid AND advertiser_id NOT IN ids   (never other users)
```

## Related Code Files
- Modify: `lib/tiktok/tiktok-connection.ts`, `lib/types.ts`
- Create: `lib/tiktok/advertiser-sync.ts`, `lib/tiktok/control-guard.ts`
- Delete: none

## Implementation Steps
1. `tiktok-connection.ts`: rename table to `tiktok_connections`; `TiktokConnectionRow` = `{ user_id, access_token, refresh_token|null, token_expires_at|null, connected_at, updated_at }` (drop `id`, `connected_by`). Every query `.eq('user_id', userId)`.
2. `writeTokens(data, userId, connectedAt|null)` upserts `{ user_id, access_token, token_expires_at, updated_at, refresh_token? , connected_at? }` with `onConflict: 'user_id'`. Keep null-expiry logic verbatim.
3. `refreshAccessToken` race guard: `getConnection(conn.user_id)`; persist via `writeTokens(data, conn.user_id, conn.connected_at)`.
4. Add `listConnectedUserIds(userIds)`: `select('user_id').in('user_id', userIds)`; return [] for empty input (skip query).
5. Update header comment ("per-user OAuth connections"). Trim long comments to stay < 200 lines.
6. Create `advertiser-sync.ts`: move `syncAdvertiserAccounts` body from callback, add `user_id` to every row, upsert `onConflict: 'advertiser_id,user_id'`, stored-row lookup + stale delete filtered `.eq('user_id', userId)`. Move `handleResyncNames` logic from accounts route (return data object, not Response), also `.eq('user_id', userId)` on select + upsert rows include `user_id`. Keep "unresolved lookup keeps stored name/currency" and "zero advertisers = throw" rules.
7. Create `control-guard.ts`: query `tiktok_ad_accounts` (`advertiser_id`, `user_id = userId`, `is_selected = true`, `maybeSingle`) -> `errorResponse('You can only control TikTok accounts you connected (and selected) in Settings', 403)`; then `getValidAccessToken(userId)` mapped through `describeAuthError` to `errorResponse`.
8. `lib/types.ts`: update `TiktokAdvertiserAccount` doc comment ("per-user"); add
   `export interface TiktokStaffMember { id: string; email: string; accounts: TiktokAdvertiserAccount[] }`.

## Todo List
- [x] Re-key tiktok-connection.ts by user_id (keep long-term token behavior)
- [x] listConnectedUserIds
- [x] advertiser-sync.ts (sync + resync names, user-scoped)
- [x] control-guard.ts
- [x] types: TiktokStaffMember + comment
- [x] Lib files type-check clean

## Success Criteria
- `grep -rn "tiktok_connection'" lib app` returns nothing (old table name gone from code after Phases 2-6).
- `grep -rn "access_token" lib/tiktok` only matches tiktok-connection.ts (+ request bodies in tiktok-client/exchange).
- Every `.from('tiktok_ad_accounts')` write/delete carries `.eq('user_id', …)` or `user_id` in the row.

## Risk Assessment
| Risk | L x I | Mitigation |
|------|-------|-----------|
| Stale-delete wipes other users' rows | M x H | Delete always `.eq('user_id', userId)`; reviewer greps for it |
| Long-term-token fix regressed during rewrite | M x H | Keep `refresh_token &&` guard + null-expiry branch verbatim; test 3 in Phase 7 |
| File > 200 lines | M x L | Trim comments; describeAuthError may move to `tiktok-auth-error.ts` if needed |

## Security Considerations
- Ownership gate is DB-side (`user_id = requester`), not client-supplied.
- `listConnectedUserIds` never selects token columns — safe for pages/loaders.

## Rollback
Code-only; revert commit (old tables still present until Phase 7).

## Next Steps
Phases 3, 4, 5, 6 (parallel).
