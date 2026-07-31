# Phase 02 — Launch-Token Store/Verify API + Settings Card + Scope Help-Text

## Context Links
- Settings page: `app/settings/page.tsx` (token input 154-165; scope help-text **136-137**; role-gated TikTok card **220**)
- Sibling card precedent: `app/settings/tiktok-connection-card.tsx`
- Existing settings API: `app/api/settings/route.ts` (GET returns `has_token` only, never the token — line 24)
- Crypto helper: `lib/crypto/token-crypto.ts` (Phase 01)
- Research (scope gap): `plans/reports/researcher-260731-1539-fb-marketing-api-ad-creation.md` §6

## Overview
- **Priority:** P0 — blocks 03
- **Status:** pending · **Effort:** 3h
- **Description:** A second, encrypted, ads-launching FB token per user, entered in Settings, verified against `/me/permissions` on save, decrypted only inside server routes.

## Key Insights
- **Two tokens, not one.** The existing `profiles.fb_access_token` stays the read-only dashboard/reporting token. Reasons a single shared token is wrong here: (a) `app/api/accounting-export/route.ts:60` bulk-loads *other* users' `fb_access_token` for org-wide fan-out — reusing one token would hand a money-capable credential to that code path; (b) `app/api/cron/check-spending-limits/route.ts` runs unattended with those tokens; (c) rotation cadence differs (a leaked reporting token is an information incident, a leaked `ads_management` token is a financial one). Cost of the choice: users paste two tokens. Accepted.
- **Verify scopes at save time, not at publish time.** A token missing `pages_show_list` still saves fine but silently yields an empty Page dropdown three screens later. `GET /me/permissions` returns `data[{permission, status}]` — store the `status === 'granted'` names in `granted_scopes`.
- Required: `ads_management` (hard — reject save), `ads_read`, `pages_show_list`, `pages_read_engagement` (soft — save with a visible warning; Page selection will not work). Current help-text (`page.tsx:136-137`) only mentions the first two → must be updated.
- The token is **never** returned to the browser after save (mirrors `app/api/settings/route.ts:24`'s `has_token` boolean).

## Requirements
- `PUT /api/afs-niche-testing/launch-token` — validate → `/me/permissions` → encrypt → upsert.
- `GET` — `{ has_token, granted_scopes, verified_at, missing_scopes[] }` (no ciphertext, no plaintext).
- `DELETE` — remove row.
- All three: `auth.getUser()` + `requireRole(user.id, ['admin','leader'])`.
- `getLaunchToken(userId): Promise<string>` server helper used by every Phase 03/06 route.

## Architecture

```
Settings card (client)
  PUT { token }  ──► route: auth → requireRole → trim/shape-check ("EAA" prefix, len>50)
                        → fbGet('/me/permissions', {}, token)      [validity + scopes in ONE call]
                        → missing ads_management? → 400, nothing stored
                        → encryptToken(token, user.id) → upsert afs_launch_tokens
                        → 200 { granted_scopes, missing_scopes }
  GET  ──► { has_token, granted_scopes, verified_at, missing_scopes }

lib/afs/launch-token.ts
  getLaunchToken(userId) → service.from('afs_launch_tokens').select(...).eq(user_id)
                         → null row  → throw Error('No ads-launching token configured — add one in Settings')
                         → decryptToken(row.token_enc, userId)
```

## Related Code Files
**Create:** `lib/afs/launch-token.ts`, `app/api/afs-niche-testing/launch-token/route.ts`, `app/settings/ads-launch-token-card.tsx`
**Modify:** `app/settings/page.tsx` (render the card next to the TikTok card at line 220; update help-text 136-137)

## Implementation Steps

1. `lib/afs/launch-token.ts`:
   - `REQUIRED_SCOPES = ['ads_management','ads_read','pages_show_list','pages_read_engagement'] as const`
   - `fetchGrantedScopes(token)` → `fbGet('/me/permissions', {}, token)` → `data.filter(p => p.status==='granted').map(p => p.permission)`
   - `saveLaunchToken(userId, token)` → verify → `encryptToken` → `service.from('afs_launch_tokens').upsert({user_id, token_enc, granted_scopes, verified_at: new Date().toISOString(), updated_at: ...})`
   - `getLaunchToken(userId)` → decrypt or throw the actionable message above
   - `missingScopes(granted)` helper (DRY between route + card)
2. `app/api/afs-niche-testing/launch-token/route.ts` — GET / PUT / DELETE, each: `createClient().auth.getUser()` → 401; `requireRole(['admin','leader'])` → 403; `try/catch` around the FB call returning the parsed FB message (`fb-client.ts:10-19` already formats `OAuthException | (#200) ... [trace: …]`) as a 400, **not** a 500 — an invalid pasted token is user error.
   - PUT rejects when `!granted.includes('ads_management')`: `400 "Token is missing ads_management — regenerate it in Graph API Explorer with all four permissions."`
   - Never log the token (no `console.log(body)`).
3. `app/settings/ads-launch-token-card.tsx` (client, ~120 lines) — mirrors the existing card shape: masked `type="password"` input, "Verify & Save" button, `✓ Token configured · verified {date}` state with Remove, amber warning listing `missing_scopes`, red error line. Loads state from `GET` on mount.
4. `app/settings/page.tsx`:
   - Import + render `{(role === 'admin' || role === 'leader') && <AdsLaunchTokenCard />}` directly under the TikTok card (line 220). Keeps its own save (independent of the page's `handleSave`) so the money-token is never bundled into an unrelated PATCH.
   - Update lines 136-137 help-text to list all four scopes and note the read-only token is for the dashboard only.
5. `npx tsc --noEmit`, `npm run lint`, `npm run build`.

## Todo List
- [x] `lib/afs/launch-token.ts` with `getLaunchToken` / `saveLaunchToken` / `missingScopes`
- [x] Route: GET/PUT/DELETE with auth + role gate + FB-error-as-400
- [x] Settings card component; render gated to admin/leader
- [x] Update scope help-text at `app/settings/page.tsx:136-137`
- [ ] Manually verify DB stores ciphertext (`select token_enc from afs_launch_tokens` shows `v1:…`) [BLOCKED: requires live DB with real token]
- [ ] Verify GET response body contains no token material [BLOCKED: requires live testing]
- [x] Typecheck + lint + build

## Success Criteria
- Pasting a valid 4-scope token → `✓ configured` + all four scopes listed; DB column starts with `v1:`.
- Pasting a token with only `ads_management`+`ads_read` → saves, amber warning names the two missing `pages_*` scopes.
- Pasting garbage → inline FB error message, nothing written.
- Staff account → 403 from all three verbs.
- `getLaunchToken` returns the exact original string; another user's id fails to decrypt.
- Existing Settings behavior (FB read token, ad accounts, TikTok card) unchanged.

## Risk Assessment
| Risk | L | I | Mitigation |
|------|---|---|-----------|
| User pastes the *same* token in both fields | High | Low | Allowed and harmless; help-text explains the split. No de-dup logic (YAGNI) |
| `/me/permissions` shape differs for system-user tokens | Med | Med | Treat empty/absent `data` as "unverifiable": save blocked with an explicit message rather than assuming granted |
| Token expires between save and publish | Med | High | Publish surfaces the FB error verbatim + "re-verify in Settings"; `verified_at` shown on the card |
| Two settings cards → user clicks the page-level Save expecting it to save the launch token | Med | Med | Card has its own button + its own success state; label reads "Verify & Save Launch Token" |
| Someone adds the token to a GET response while debugging | Low | High | Route file header comment: "never return token material"; review checklist item |

## Security Considerations
- Plaintext token exists only in-request (PUT body, and in memory during `getLaunchToken`) — never in DB, logs, or any client payload.
- Role gate on all verbs; a staff account cannot even store a launch token.
- Decryption is AAD-bound to `user_id` (Phase 01) — a DB-write-capable attacker cannot transplant another user's ciphertext into their row.
- `DELETE` is the user-facing kill switch: no token ⇒ every publish/asset route fails closed.

## Next Steps
- Phase 03 consumes `getLaunchToken` for pages/pixels/publish.
- Phase 04 is independent of this phase and may run in parallel.
