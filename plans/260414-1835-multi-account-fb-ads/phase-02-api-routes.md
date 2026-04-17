# Phase 2 — API Routes

## Context Links
- [Current settings route](../../app/api/settings/route.ts)
- [Current campaigns route](../../app/api/campaigns/route.ts)
- [Phase 1 — DB Schema](./phase-01-db-schema-types.md)

## Overview
- **Priority:** P1 (blocker for Phase 3 and 4)
- **Status:** Pending
- **Depends on:** Phase 1
- **Description:** Rewrite settings API for multi-account CRUD, add reveal endpoint, update campaigns to accept accountId param

## Key Insights
- Current settings route uses PATCH on profiles table — new route uses POST (add) on fb_accounts
- Current campaigns route reads credentials from profiles — new route reads from fb_accounts by ID
- Reveal endpoint is standalone — verifies ADMIN_PASSWORD env var, not Supabase auth
- All routes use service client to bypass RLS (existing pattern)

## Requirements

### Functional
- `GET /api/settings` — return all user's fb_accounts (id, label, fb_ad_account_id, created_at — NO tokens)
- `POST /api/settings` — add new account (label, fb_ad_account_id, fb_access_token)
- `DELETE /api/settings/[accountId]` — remove account by ID (must belong to user)
- `POST /api/settings/reveal` — accept {accountId, password}, verify password against ADMIN_PASSWORD, return fb_access_token
- `GET /api/campaigns?accountId=X` — load credentials from fb_accounts where id=X and user_id matches

### Non-functional
- All endpoints require Supabase auth (existing pattern)
- Reveal endpoint additionally requires admin password match
- Token never returned except via reveal endpoint

## Architecture

```
Client                    API Route                        Supabase / Env
──────                    ─────────                        ──────────────
GET /api/settings    →  select id,label,fb_ad_account_id,created_at from fb_accounts where user_id=X
POST /api/settings   →  insert into fb_accounts (user_id, label, fb_ad_account_id, fb_access_token)
DELETE /settings/[id]→  delete from fb_accounts where id=Y and user_id=X
POST /settings/reveal→  compare password vs ADMIN_PASSWORD env → select fb_access_token from fb_accounts where id=Y and user_id=X
GET /campaigns?accountId=Y → select fb_access_token, fb_ad_account_id from fb_accounts where id=Y and user_id=X → FB API
```

## Related Code Files

### Modify
- `app/api/settings/route.ts` — rewrite GET (list accounts), replace PATCH with POST (add account)
- `app/api/campaigns/route.ts` — accept accountId query param, load from fb_accounts

### Create
- `app/api/settings/[accountId]/route.ts` — DELETE handler
- `app/api/settings/reveal/route.ts` — POST handler for token reveal

### Delete
- None

## Implementation Steps

### 1. Rewrite `app/api/settings/route.ts`

**GET handler:**
```
1. Auth check (existing pattern)
2. service.from('fb_accounts').select('id, label, fb_ad_account_id, created_at').eq('user_id', user.id).order('created_at')
3. Return { accounts: data }
```

**POST handler (replaces PATCH):**
```
1. Auth check
2. Parse body: { label, fb_ad_account_id, fb_access_token }
3. Validate all three fields are non-empty strings
4. Validate fb_ad_account_id starts with "act_"
5. service.from('fb_accounts').insert({ user_id: user.id, label, fb_ad_account_id, fb_access_token }).select('id, label, fb_ad_account_id, created_at').single()
6. Handle unique constraint violation → 409 "Account already exists"
7. Return { account: data }
```

Remove the PATCH export entirely.

### 2. Create `app/api/settings/[accountId]/route.ts`

**DELETE handler:**
```
1. Auth check
2. Extract accountId from params
3. service.from('fb_accounts').delete().eq('id', accountId).eq('user_id', user.id)
4. If no rows deleted → 404 "Account not found"
5. Return { success: true }
```

Note: params access pattern — check Next.js 16 docs for dynamic route params in API routes.

### 3. Create `app/api/settings/reveal/route.ts`

**POST handler:**
```
1. Auth check
2. Check ADMIN_PASSWORD env var exists → 501 "Token reveal not configured" if missing
3. Parse body: { accountId, password }
4. Compare password === process.env.ADMIN_PASSWORD → 403 "Invalid password" if mismatch
5. service.from('fb_accounts').select('fb_access_token').eq('id', accountId).eq('user_id', user.id).single()
6. If not found → 404 "Account not found"
7. Return { token: data.fb_access_token }
```

Security: use constant-time comparison for password (timingSafeEqual from crypto).

### 4. Update `app/api/campaigns/route.ts`

```
1. Auth check (unchanged)
2. Read accountId from URL search params: new URL(request.url).searchParams.get('accountId')
3. If no accountId → 400 "accountId query param required"
4. service.from('fb_accounts').select('fb_access_token, fb_ad_account_id').eq('id', accountId).eq('user_id', user.id).single()
5. If not found → 404 "Account not found"
6. Rest of function unchanged (fetchCampaigns with token + account ID)
```

Note: GET handler must accept `request: NextRequest` param (currently has no param).

## Todo List

- [ ] Rewrite GET /api/settings to return accounts list from fb_accounts
- [ ] Replace PATCH with POST in /api/settings for adding accounts
- [ ] Create DELETE /api/settings/[accountId] route
- [ ] Create POST /api/settings/reveal route with admin password check
- [ ] Update GET /api/campaigns to accept accountId query param
- [ ] Verify all routes compile without errors

## Success Criteria
- GET /api/settings returns array of accounts without tokens
- POST /api/settings creates account and returns it (without token)
- POST with duplicate fb_ad_account_id returns 409
- DELETE removes account; returns 404 for non-existent/non-owned
- Reveal with correct password returns token; wrong password returns 403; missing env var returns 501
- Campaigns with valid accountId fetches from FB; missing param returns 400

## Risk Assessment
| Risk | Mitigation |
|------|------------|
| Timing attack on admin password | Use crypto.timingSafeEqual for comparison |
| accountId param is UUID — SQL injection | Supabase client parameterizes queries automatically |
| PATCH consumers break | Only consumer is settings page, updated in Phase 3 (deploy together) |

## Security Considerations
- Token never in GET response — only via reveal with admin password
- All queries scoped by user_id — no cross-user access even with valid account UUID
- Admin password comparison uses constant-time comparison
- Rate limiting on reveal endpoint is recommended (not in scope — can add later)

## Next Steps
- Phase 3 (Settings UI) and Phase 4 (Dashboard) can start once this phase is complete
