# Phase 01 — DB Schema + Types + `getVisibleUserIds` Helper

## Context Links
- Schema file: `supabase/schema.sql` (append at end — see `tiktok_advertiser_accounts` block for the org-wide, no-policy RLS pattern)
- Types file: `lib/types.ts`
- Auth helpers: `lib/auth-guards.ts` (`getUserRole`, `requireRole`, `canViewAs`)
- Admin listUsers precedent: `app/api/admin/users/route.ts:22` (`service.auth.admin.listUsers` + profiles join)

## Overview
- **Priority:** P0 (blocker for 02–06)
- **Status:** completed
- **Description:** Add the org-wide `account_owners` table, two export types, and a `getVisibleUserIds` role-scoping helper. Foundation only — no runtime behavior yet.

## Key Insights
- `account_owners` is org-wide/shared, NOT per-user → mirror `tiktok_advertiser_accounts`: RLS **enabled, zero policies**; only `createServiceClient()` touches it; the API route is the sole enforcement point.
- Composite PK `(account_id, platform)` — the same numeric account id could theoretically exist on both platforms; platform disambiguates.
- **[Red Team Fix #7]** table gains `updated_by uuid` — this table feeds financial reporting, so writes must be traceable to a user.
- **[Red Team Fix #1]** the Accounting Export tool gates everything to **admin/leader** (done in Phase 04/05, not here). `getVisibleUserIds` keeps its generic `staff → [self]` branch (still a correct general-purpose helper) but that branch is **unreachable via this tool** — the route-level `requireRole` rejects staff before it is ever called with a staff role. Do not delete the branch.
- `getVisibleUserIds` belongs in `lib/auth-guards.ts` (DRY — same file, same concern as `canViewAs`). It reuses the exact `listUsers` + `team_members` shapes already proven in the admin route and `canViewAs`.
- **[Red Team Fix #5]** the admin branch MUST check `listUsers`' `.error` (like `app/api/admin/users/route.ts:27`) and throw — silently falling back to `[userId]` would scope an "org-wide" admin export down to the admin's own profile with no signal.
- `account_name`/`currency` live in `fb_ad_accounts`/`tiktok_advertiser_accounts`, NOT in `account_owners` (which stores only the label) — joined in at read time.

## Requirements
- New table `public.account_owners` (idempotent, RLS on, no policies).
- Two interfaces in `lib/types.ts`: `AccountingExportRow`, `AccountOwnerEntry`.
- `getVisibleUserIds(userId, role): Promise<string[]>` in `lib/auth-guards.ts`.

## Architecture
Additive only. One new table, two new types, one new pure-async helper. No triggers, no policies, no changes to existing tables/types.

```
getVisibleUserIds(userId, role)
  admin  → service.auth.admin.listUsers({perPage:200}) → users.map(u => u.id)
  leader → [userId, ...team_members.staff_id where leader_id = userId]
  staff  → [userId]
```

## Related Code Files
**Modify:**
- `supabase/schema.sql` (append `account_owners` block)
- `lib/types.ts` (append `// ─── Accounting Export ──` section with two interfaces)
- `lib/auth-guards.ts` (add `getVisibleUserIds`)

**Create:** none.

## Implementation Steps

1. Append to `supabase/schema.sql` (after the `tiktok_advertiser_accounts` block):
   ```sql
   -- ─── account_owners: person-in-charge / department mapping for Accounting Export ──
   -- Org-wide, service-role-only (mirrors tiktok_advertiser_accounts): RLS enabled with
   -- NO policies — only createServiceClient() reads/writes; the API route enforces access.
   create table if not exists public.account_owners (
     account_id text not null,
     platform text not null check (platform in ('facebook','tiktok')),
     owner_label text not null default '',
     updated_at timestamptz default now(),
     updated_by uuid references auth.users(id),   -- [Red Team Fix #7] audit trail for financial data
     primary key (account_id, platform)
   );

   alter table public.account_owners enable row level security;
   ```

2. Run the migration in the Supabase SQL editor (manual step — document, don't automate).

3. Append to `lib/types.ts`:
   ```typescript
   // ─── Accounting Export ──────────────────────────────────────────────────────
   export interface AccountingExportRow {
     platform: 'facebook' | 'tiktok';
     account_id: string;
     account_name: string;
     campaign_id: string;
     campaign_name: string;
     currency: string;          // original account currency, NOT converted
     spend: number;             // original currency amount
     target_type: 'app' | 'website' | 'unknown';
     target_label: string;      // app name (FB) / app_id (TikTok) / website domain / 'Unknown'
     owner_label: string;       // '' if unassigned in account_owners
   }

   export interface AccountOwnerEntry {
     account_id: string;
     platform: 'facebook' | 'tiktok';
     account_name: string;      // joined from fb_ad_accounts/tiktok_advertiser_accounts
     currency: string;
     owner_label: string;
   }
   ```

4. Add to `lib/auth-guards.ts` (below `canViewAs`):
   ```typescript
   /**
    * Returns the set of user_ids whose FB data the requester may view.
    * admin → every user with a profile row; leader → self + assigned staff; staff → [self].
    * Used by the Accounting Export routes for role-scoped fan-out and owner-label writes.
    */
   export async function getVisibleUserIds(
     userId: string,
     role: UserRole,
   ): Promise<string[]> {
     const service = createServiceClient();
     if (role === 'admin') {
       // [Red Team Fix #5] check .error (mirrors app/api/admin/users/route.ts) — never silently
       // fall back to [userId], which would shrink an org-wide export to just the admin.
       const { data, error } = await service.auth.admin.listUsers({ perPage: 200 });
       if (error) throw new Error(`listUsers failed: ${error.message}`);
       const ids = (data?.users ?? []).map((u) => u.id);
       return ids.length ? ids : [userId];
     }
     if (role === 'leader') {
       const { data } = await service
         .from('team_members')
         .select('staff_id')
         .eq('leader_id', userId);
       const staff = (data ?? []).map((r) => (r as { staff_id: string }).staff_id);
       return [userId, ...staff];
     }
     return [userId];
   }
   ```

5. `npx tsc --noEmit` to confirm no breakage.

## Todo List
- [x] Append `account_owners` block to `supabase/schema.sql`
- [ ] Run migration in Supabase SQL editor
- [x] Verify: `select * from information_schema.tables where table_name='account_owners'`
- [x] Verify RLS on, no policies: `select * from pg_policies where tablename='account_owners'` returns 0 rows
- [x] Add `AccountingExportRow` + `AccountOwnerEntry` to `lib/types.ts`
- [x] Add `getVisibleUserIds` to `lib/auth-guards.ts` (**[Fix #5]** admin branch throws on `listUsers` error)
- [x] Confirm `updated_by` column present (**[Fix #7]**)
- [x] `npx tsc --noEmit` passes

## Success Criteria
- `account_owners` exists (incl. `updated_by`); re-running migration is a no-op (no error).
- `pg_policies` shows zero policies for the table.
- `getVisibleUserIds` returns correct arrays for each role; **[Fix #5]** a simulated `listUsers` error throws rather than returning `[userId]`.
- `npx tsc --noEmit` passes.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Forgetting RLS enable → table readable via anon key | Low | High | Copy the `tiktok_advertiser_accounts` block verbatim; verify via `pg_policies` = 0 AND RLS enabled |
| `listUsers` capped at 200 hides users for very large orgs | Low | Med | Matches existing admin route; acceptable now. Flag pagination if org > 200 |
| `UserRole` import missing in auth-guards | Low | Low | Already imported at top of `lib/auth-guards.ts` |

## Security Considerations
- No RLS policies is **intentional** and matches precedent — enforcement is the route's job. Never expose a client (anon/authenticated key) path to this table.
- `getVisibleUserIds` uses the service client (bypasses RLS) — only ever call it from server routes after an `auth.getUser()` check.

## Next Steps
- Phase 02 & 03 (fetch layers) can start in parallel — they need only the types.
- Phase 04 & 05 consume `getVisibleUserIds` + `account_owners`.
