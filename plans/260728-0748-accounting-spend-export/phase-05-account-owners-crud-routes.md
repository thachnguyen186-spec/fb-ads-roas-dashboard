# Phase 05 — `/api/account-owners` GET + PATCH (Scoped)

## Context Links
- Table + helper (Phase 01): `supabase/schema.sql` (`account_owners`), `lib/auth-guards.ts` (`getVisibleUserIds`, `getUserRole`)
- Route patterns: `app/api/campaigns/route.ts` (auth + service client), `app/api/admin/users/route.ts` (role gate + json body)
- Types (Phase 01): `lib/types.ts` (`AccountOwnerEntry`)
- Utils: `lib/utils.ts` (`errorResponse`)

## Overview
- **Priority:** P1 (depends on 01; parallel with 02–04)
- **Status:** completed
- **Description:** Two handlers in one route file, **admin/leader only**. `GET` returns every account the requester may manage (FB scoped by `getVisibleUserIds`; TikTok all) left-joined with `account_owners`. `PATCH` upserts an `owner_label` with a per-platform existence/scope check and an `updated_by` audit stamp.

## Key Insights
- **[Red Team Fix #1]** Both handlers gate to admin/leader first: `requireRole(user.id, ['admin','leader'])` (same pattern as `app/api/admin/users/route.ts`). Staff → 403.
- `GET` and `PATCH` share the "resolve the requester's manageable FB account set" logic → factor a small `loadVisibleFbAccounts(user, role)` local helper (DRY within the file).
- **Security scoping (critical):** `PATCH` for a `facebook` account must confirm `account_id` belongs to some user in `getVisibleUserIds` — otherwise a leader could rename another team's account owner by guessing an id.
- **[Red Team Fix #7]** TikTok is no longer "exempt / no check": `PATCH` for a `tiktok` account must confirm the `account_id` **exists** in `tiktok_advertiser_accounts` (no further scoping needed — the admin/leader gate already bounds who can call this). Prevents writing owner labels for phantom/guessed advertiser ids.
- **[Red Team Fix #7]** Every write stamps `updated_by: user.id` — this table feeds financial reporting and must be traceable.
- **[Red Team cleanup]** Normalize `owner_label` on write: `trim()` + collapse internal whitespace (`replace(/\s+/g,' ')`) so "Sales" and "sales " don't fragment the group-by-owner view. (Case-preserving — do not lowercase; display label stays as typed.)
- Upsert on composite PK `(account_id, platform)` — normalized `owner_label` may be `''` (clears the label). Set `updated_at = now()`, `updated_by = user.id`.
- `account_name`/`currency` come from `fb_ad_accounts`/`tiktok_advertiser_accounts`, joined at read time (not stored in `account_owners`).

## Requirements
- Both handlers: 401 without auth; **[Fix #1]** 403 if not admin/leader.
- `GET /api/account-owners` → `{ accounts: AccountOwnerEntry[] }` (FB scoped, TikTok all), each with any existing `owner_label` ('' if none).
- `PATCH /api/account-owners` → body `{ account_id, platform, owner_label }` → upsert; 403 if FB account not in visible set; **[Fix #7]** 404/400 if TikTok account not found; 400 on bad body; stamps `updated_by`.

## Architecture
```
GET  → auth → requireRole(['admin','leader']) → role → getVisibleUserIds     [Fix #1]
       fbAccounts   = fb_ad_accounts(account_id,name,currency) where user_id in visibleIds  (ALL, ignore is_selected)
       ttAccounts   = tiktok_advertiser_accounts(advertiser_id,name,currency)               (ALL)
       owners       = account_owners → Map<`${platform}:${id}`, owner_label>
       → merge → AccountOwnerEntry[]  (owner_label from map ?? '')

PATCH → auth → requireRole(['admin','leader']) → parse {account_id, platform, owner_label}   [Fix #1]
        label = owner_label.trim().replace(/\s+/g,' ').slice(0,120)          [cleanup + cap]
        if platform=='facebook':
            visibleIds = getVisibleUserIds(user.id, role)
            ok = exists fb_ad_accounts where account_id=? and user_id in visibleIds
            if !ok → 403
        if platform=='tiktok':                                               [Fix #7]
            ok = exists tiktok_advertiser_accounts where advertiser_id=?
            if !ok → 404
        upsert account_owners { account_id, platform, owner_label: label,
                                updated_at: now(), updated_by: user.id }      [Fix #7 audit]
        → { ok: true }
```

## Related Code Files
**Create:**
- `app/api/account-owners/route.ts`

**Modify:** none.

## Implementation Steps

1. Create `app/api/account-owners/route.ts` with `GET` and `PATCH`.

2. `GET`:
   - `auth.getUser()` → 401; **[Fix #1]** `requireRole(user.id, ['admin','leader'])` → 403 else; `role = (await getUserRole(user.id)) ?? 'staff'`.
   - `visibleIds = await getVisibleUserIds(user.id, role)`.
   - Parallel load: `fb_ad_accounts` (`account_id,name,currency`, `.in('user_id', visibleIds)`, **no `is_selected` filter**), `tiktok_advertiser_accounts` (`advertiser_id,name,currency`), `account_owners` (all).
   - De-dupe FB accounts by `account_id` (same account can belong to multiple users). Build `ownerMap` keyed `` `${platform}:${id}` ``.
   - Map to `AccountOwnerEntry[]` (FB: platform 'facebook'; TikTok: platform 'tiktok', id = advertiser_id), `owner_label` from map ?? ''.
   - `Response.json({ accounts })`.

3. `PATCH`:
   - `auth.getUser()` → 401; **[Fix #1]** `requireRole(user.id, ['admin','leader'])` → 403 else.
   - Parse body; validate `account_id` non-empty, `platform ∈ {facebook,tiktok}`, `owner_label` is a string (allow '').
   - **[cleanup]** `const label = owner_label.trim().replace(/\s+/g, ' ').slice(0, 120);`
   - If `platform === 'facebook'`: `role`, `visibleIds`, then `service.from('fb_ad_accounts').select('account_id').eq('account_id', account_id).in('user_id', visibleIds).limit(1)` → if empty, `errorResponse('Forbidden — account not in your visible set', 403)`.
   - **[Fix #7]** If `platform === 'tiktok'`: `service.from('tiktok_advertiser_accounts').select('advertiser_id').eq('advertiser_id', account_id).limit(1)` → if empty, `errorResponse('TikTok advertiser not found', 404)`.
   - **[Fix #7]** Upsert: `service.from('account_owners').upsert({ account_id, platform, owner_label: label, updated_at: new Date().toISOString(), updated_by: user.id }, { onConflict: 'account_id,platform' })`.
   - `Response.json({ ok: true })`.

4. Manual smoke (per role): **[Fix #1]** staff → 403 on both handlers; GET returns scoped FB + all TikTok; PATCH a visible FB account persists + `updated_by` set; PATCH a non-visible FB account (guessed id) → 403; **[Fix #7]** PATCH a non-existent TikTok id → 404; PATCH a real TikTok account as leader → allowed; whitespace-only/`"sales "` label normalizes; empty `owner_label` clears.

## Todo List
- [x] Create `app/api/account-owners/route.ts` (GET + PATCH)
- [x] **[Fix #1]** Both handlers `requireRole(['admin','leader'])` → 403 for staff
- [x] GET: FB scoped by `getVisibleUserIds` (ignore `is_selected`), TikTok all, join owners
- [x] PATCH: FB visible-set check (403); **[Fix #7]** TikTok existence check (404); normalize label; stamp `updated_by`; upsert on composite PK
- [x] `npx tsc --noEmit` passes
- [x] Smoke: staff 403, scoping, 403 non-visible FB, 404 phantom TikTok, `updated_by` set, label normalize, empty-label clear

## Success Criteria
- **[Fix #1]** staff → 403 on both handlers; admin/leader reach them.
- GET returns the requester's full manageable list with existing labels.
- PATCH persists across reload, stamps `updated_by`, and reflects in the next `/api/accounting-export`.
- Non-visible FB `account_id` upsert → 403; **[Fix #7]** non-existent TikTok id → 404.
- `"sales "` and `"Sales"` normalize to one group; label capped at 120 chars.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Missing FB scope check → cross-team label tampering | Med | High | **[Fix #1]** admin/leader gate + explicit visible-set membership check before upsert; smoke-tested |
| **[Fix #7]** Owner label written for phantom/guessed TikTok advertiser id | Med | Med | Existence check against `tiktok_advertiser_accounts` → 404 |
| **[Fix #7]** No audit trail on financial-reporting data | Med | Med | `updated_by` stamped on every write |
| Same FB account under multiple users double-counted in GET | Med | Low | De-dupe by `account_id` before mapping |
| `onConflict` string mismatch → duplicate-key error | Low | Med | Use exact `'account_id,platform'`; verify against the composite PK |
| Label-fragmentation in group-by view ("Sales" vs "sales ") | Med | Low | **[cleanup]** trim + collapse whitespace + 120-char cap on write |

## Security Considerations
- **[Fix #1]** `requireRole(['admin','leader'])` gates both handlers — staff cannot read or mutate any owner label.
- Service client bypasses RLS (table has no policies by design) — the route is the sole gate.
- FB writes bounded by `getVisibleUserIds`; **[Fix #7]** TikTok writes require the advertiser to exist and are bounded by the admin/leader gate (no longer open to everyone).
- **[Fix #7]** `updated_by` provides traceability for a financial-reporting table.
- Validate/normalize `owner_label`; reject non-string. No SQL string interpolation (parameterized via Supabase client).

## Next Steps
- Phase 06's "Manage Groupings" panel consumes GET + PATCH.
