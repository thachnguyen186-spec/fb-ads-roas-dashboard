# Phase 02 — Token binding, page sync, tool shell, settings UI

## Context Links
- `lib/afs/launch-token.ts` (verify scopes via `/me/permissions`, encrypt, upsert) · `app/api/afs-niche-testing/launch-token/route.ts` (token format check, never return token)
- `lib/facebook/pages.ts` (`/me/accounts` pagination) · `app/settings/ads-launch-token-card.tsx` (card UI) · `app/afs-niche-testing/page.tsx` (server shell)
- `lib/auth-guards.ts` (`getUserRole`) · Phase 01 tables

## Overview
- Priority: P1 · Status: Implemented — pending live verification (2-token dedupe, RBAC, token leakage) · Effort: 5h · Depends: 01 · Blocks: 03, 06
- Users bind many FB profile tokens; each add/resync pulls manageable Pages with page tokens; per-user default countries.

## Key Insights
- **UPDATED 2026-10-10 (live check of the user's real token):** the user's token is a Business Manager **SYSTEM_USER** token (app "Post Management", app_id 1588184922342623, type `SYSTEM_USER`, expires ~60d, scopes incl. pages_show_list/pages_manage_posts/pages_read_engagement/read_insights/pages_manage_metadata/business_management). Therefore:
  - Accept BOTH `USER` and `SYSTEM_USER` tokens. `FB_APP_ID`/`FB_APP_SECRET` are **optional** (never 500 when missing).
  - `debug_token`: use `access_token=APP_ID|APP_SECRET` if env set, else `access_token=<the pasted token itself>` (verified working live). Read `type`, `app_id`, `is_valid`, `expires_at` (0 = never), `scopes`.
  - If env `FB_APP_ID` is set, reject tokens whose `app_id` differs. Exchange for long-lived ONLY when `type==='USER'` and env present; SYSTEM_USER tokens stored as pasted (already long-lived / never-expiring). USER token + no env → store as pasted with an expiry warning.
  - Pages: `GET /me/accounts` works for system users ONLY for Pages assigned to the system user in Business Settings (live: 0 pages when none assigned). Zero pages → success response with a clear hint: "No Pages found — assign Pages to this system user in Business Settings → Users → System users → Assign assets (Content + Insights; Full control for profile picture)".
  - App-role prerequisite applies only to USER tokens.
- (original) User owns the Meta app -> every pasted USER token exchanged for long-lived (~60d); page tokens from `/me/accounts` never expire.
- After ~60d the user token expires: existing page tokens keep working; only resync needs a fresh paste (UI shows expiry date).
- Visibility mirrors FB dashboard: reuse `getVisibleUserIds(userId, role)` from `lib/auth-guards.ts` (admin all, leader self+team via `team_members`, staff self).
- Same Page via 2 profiles -> one row per (user, page_id). Keep the token whose `tasks` include `CREATE_CONTENT`; tie -> latest sync wins.
- Every FB profile must hold admin/developer/tester role on the user's Meta app until App Review/Advanced Access -> help text; token must be generated from that app.

## Requirements
- Functional: add token (exchange + debug_token; reject `app_id` != `FB_APP_ID`; verify, hard-required `pages_show_list, pages_manage_posts, pages_read_engagement`; warn on missing `read_insights`), list profiles, resync one profile, remove profile (cascade pages, re-sync remaining profiles so deduped pages re-attach), list pages, get/put default countries.
- Non-functional: tokens never in responses/logs; token in POST body only; all roles allowed; files <200 lines.

## Architecture
```
POST /api/page-scheduler/profiles {token}
  -> format check (EAA..., len>50) -> env check (500 'FB app not configured' if missing)
  -> exchange: GET /oauth/access_token?grant_type=fb_exchange_token&client_id&client_secret&fb_exchange_token
  -> GET /debug_token?input_token=<long>&access_token=APP_ID|APP_SECRET (is_valid, app_id, expires_at, scopes)
  -> GET /me?fields=id,name
  -> missing hard scope? 400 (nothing stored) -> upsert ps_fb_profiles(user_id, fb_user_id) token_enc (long-lived), expires_at
  -> syncPagesForProfile(): GET /me/accounts?fields=id,name,category,picture{url},access_token,tasks&limit=100 (follow paging.next)
     -> per page: existing row from other profile with CREATE_CONTENT and new lacks it? skip : upsert (page_token_enc)
     -> rows of THIS profile not returned -> is_active=false
  -> returns {profile, pages_added, pages_total, missing_optional_scopes, expires_at}
```
Access helper `lib/page-scheduler/access.ts`: `getPsContext() -> {userId, role, visibleUserIds}` (401 if no user; `visibleUserIds = getVisibleUserIds(userId, role)`). `resolveOwnerFilter(ctx, ownerParam)` -> `'all'`/absent = visibleUserIds, a uuid must be in visibleUserIds else 403. `ownerLabels(ids)` -> email map via `service.auth.admin.listUsers` (only when >1 visible user). `assertOwner(ctx, row)` for every mutation (`row.user_id === userId`, else 403) — leaders/admins are read-only on others' rows.

Page token lookup `getPageToken(userId, pageId)` -> decrypt `ps_pages.page_token_enc` (AAD userId); throws actionable error if page inactive or profile `invalid`. `markProfileInvalid(profileId, msg)` used by later phases on code 190.

API routes (all `createClient()` auth -> service client; async `params: Promise<...>` per existing routes):
| Route | Methods |
|---|---|
| `app/api/page-scheduler/profiles/route.ts` | GET own list, POST add |
| `app/api/page-scheduler/profiles/[profileId]/route.ts` | POST resync, DELETE remove (owner only) |
| `app/api/page-scheduler/pages/route.ts` | GET list (id, name, picture, tasks, profile name, is_active, owner) — `?owner=` within visible users |
| `app/api/page-scheduler/settings/route.ts` | GET/PUT `default_countries` (validate ISO2 list, 1-25 codes) |

UI: `/page-scheduler` server page (login required, any role) -> client hub with tabs **Upload | Queue | Analytics | Settings** (Phase 02 renders Settings only; later phases add their tab component — one import line each). Settings tab = profiles card + pages table + default-countries card. Leader/admin get an owner filter (All visible / Me / specific user) on Pages, Queue, Analytics; profiles + default countries are always own-only. Non-owned rows render without action buttons.

## Related Code Files
- Create: `lib/page-scheduler/access.ts`, `lib/page-scheduler/fb-profiles.ts` (add/remove/getPageToken/markProfileInvalid), `lib/page-scheduler/page-sync.ts`, `lib/page-scheduler/token-exchange.ts` (exchange + debug_token), `lib/page-scheduler/country-codes.ts` (ISO2 set + tier-1 preset), the 4 route files above, `app/page-scheduler/page.tsx`, `app/page-scheduler/components/page-scheduler-hub.tsx`, `.../components/settings-tab.tsx`, `.../components/fb-profiles-card.tsx`, `.../components/pages-table.tsx`, `.../components/default-countries-card.tsx`
- Modify: none outside new dirs (`.env.local.example` add required `FB_APP_ID`, `FB_APP_SECRET` if file exists)
- Delete: none

## Implementation Steps
1. `access.ts` + `country-codes.ts`.
2. `token-exchange.ts`: `exchangeLongLived(token)` (v26 base; throws on missing env or FB error — nothing stored) and `debugToken(token)` (app token `APP_ID|APP_SECRET`; secret never logged/returned).
3. `fb-profiles.ts`: `addProfile(userId, token)`, `removeProfile(userId, profileId)` (delete row -> cascade pages -> resync remaining active profiles sequentially), `getPageToken`, `markProfileInvalid`.
4. `page-sync.ts`: paginated fetch, dedupe rule, upsert, deactivate missing; catch 190 -> `markProfileInvalid`.
5. Routes (role: any authenticated; DELETE/POST check ownership).
6. UI components; textarea for token (type=password style), scopes badges, "Resync", "Remove" (confirm), token expiry date; warning banners (`invalid` profile, user token expiring <7d ("re-paste to keep resync working"), missing `read_insights`, pages lacking CREATE_CONTENT/MANAGE).
7. typecheck/lint/build; manual test with 2 tokens sharing one Page.

## Todo List
- [x] access / country-codes / token-exchange
- [x] fb-profiles / page-sync
- [x] 4 API routes
- [x] page shell + hub + settings tab components
- [ ] manual 2-token dedupe test (blocked: needs Phase 01 SQL applied in Supabase + 2 real tokens)

## Success Criteria
- Adding a valid token lists all its Pages within one request (<=100 Pages, paging followed).
- Missing `pages_manage_posts` -> 400 with FB-scope message; no DB row.
- Shared Page appears once; removing the owning profile re-attaches it to the other profile.
- No response body contains `token`, `token_enc`, `page_token_enc`, `access_token` (grep network tab).
- Staff sees only own pages; leader sees own + team (`?owner=all`), forged `?owner=<non-team uuid>` -> 403; admin sees all. Any non-owner mutation -> 403.
- Stored profile `expires_at` ~60d out; a synced page token shows `Expires: Never` in Access Token Debugger.
- Token from another app -> 400 "token not issued by this app".

## Risk Assessment
| Risk | L x I | Mitigation |
|---|---|---|
| Pasted token from wrong app / no app role | M x H | debug_token `app_id` check; help text on app roles; FB message surfaced |
| Missing env in Vercel | M x H | Explicit 500 "FB app not configured"; manual step in plan.md |
| Business-portfolio Pages missing | M x M | Document; out of scope (needs business_management) |
| >100 pages / slow sync | L x L | Pagination; 20-50 pages expected |
| Profile without app role -> permission errors | M x M | Help text + surfaced FB message |

## Security Considerations
- POST body only; never log body. Encrypt with AAD = user_id. `assertOwner` on every mutation; leader/admin read-only on others. `FB_APP_SECRET` server-only, never in responses/logs.
- Token format pre-check rejects junk before any FB call.

## Next Steps
- Phase 03 uses `ps_pages` (active, `CREATE_CONTENT`) for validation; Phase 06 adds picture action to `pages-table.tsx`.

## Sync-back deltas (2026-10-11)
- Supersedes Architecture above: `FB_APP_ID`/`FB_APP_SECRET` optional; no 500 when missing. Exchange only for `USER` tokens with env set. `SYSTEM_USER` accepted as pasted.
- Page-token and `markProfileInvalid` implemented as specified. Zero-Page hint returned on success.
- Live manual 2-token dedupe and RBAC checks still open.
