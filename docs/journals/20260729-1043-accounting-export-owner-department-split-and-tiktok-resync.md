# Accounting Export: Owner/Department Split + TikTok Resync Action

**Date**: 2026-07-29 10:43  
**Severity**: Medium (two manual Supabase SQL steps pending; tool will error until both run)  
**Component**: Accounting Export Tool (admin/leader-only; account owner management)  
**Status**: Implementation complete; manual schema deployment required before production  
**Commits**: Two follow-up fixes merged; no schema changes run against live Supabase yet

## What Happened

Two critical follow-up fixes shipped after code review surfaced a race condition and operational gap:

1. **Owner/Department Field Split** (`account_owners.owner_label` → `owner_label` + `department_label`):
   - Original plan used a single combined `owner_label` field for both owner name and department grouping.
   - Code review caught a race condition: concurrent PATCH requests to `account_owners` could trigger partial updates (update one field, fail on another), corrupting the combined data.
   - Solution: Split into two independent columns (`owner_label`, `department_label`) backed by a new atomic RPC function `upsert_account_owner_label()` (appended to `supabase/schema.sql`).
   - The RPC function performs both column updates in a single SQL transaction, eliminating the race condition.
   - UI and export routes updated to use both fields independently.

2. **TikTok Account Name Resync Action**:
   - Operationally: TikTok accounts sync on initial connection via `POST /api/tiktok/accounts`, but a chunking bug (fixed in commit `2aed53f`) was causing advertiser IDs to appear as raw numbers instead of names in stored rows.
   - Root cause: TikTok API call was being chunked at 100-per-request, but one chunk was silently failing mid-sync.
   - Users who connected TikTok before the fix were stuck with raw IDs in their account list; full disconnect (which wipes `is_selected` preferences) was the only workaround.
   - Solution: New non-destructive PATCH action on `/api/tiktok/accounts` with `{action:'resync_names'}` re-fetches advertiser names and updates stored rows, preserving all `is_selected` account preferences.
   - UI: Settings page now includes a "Resync TikTok account names" button for operators to fix this without losing configuration.

## The Brutal Truth

The race condition in the original owner/department logic would have surfaced during high-concurrency admin edits (e.g., bulk department reassignment). A concurrent PATCH could leave the database with stale or corrupt owner/department data, silently causing export rows to group under wrong owners until admin manually re-applied the fix. This is a data-integrity bug that code review caught before schema deployment — exactly why hostile review exists.

The TikTok resync gap is less severe but operationally important: any user who connected TikTok accounts before commit `2aed53f` is seeing raw advertiser IDs in their Settings page, making account selection confusing. The resync action is the band-aid; the real fix (the chunking bug) is already in commit `2aed53f`.

## Technical Details

**Database changes** (appended to `supabase/schema.sql`; NOT YET DEPLOYED):
- New column `account_owners.department_label` (text, nullable)
  - Independent of `owner_label`; allows accounts to be grouped by department without changing the owner name
- New RPC function `upsert_account_owner_label(p_user_id UUID, p_owner_label TEXT, p_department_label TEXT)`
  - Atomic transaction: updates both columns together, or fails entirely
  - Returns the updated row for client confirmation
  - Eliminates partial-update race condition

**API routes** (modified):
- `PATCH /api/account-owners/route.ts`:
  - Request body now accepts both `owner_label` and `department_label` (optional fields)
  - Calls RPC function `upsert_account_owner_label()` instead of direct SQL UPDATE
  - Returns conflict (409) if concurrent request detected; forces retry (idempotent pattern)

- `PATCH /api/tiktok/accounts/route.ts`:
  - New request handling: accepts `{action: 'resync_names'}` in body
  - Fetches fresh advertiser names from TikTok API (same logic as initial sync)
  - Updates only the `name` field of stored account rows; preserves `is_selected` and all other fields
  - Returns `{ updated_count, unchanged_count }` to surface results to UI

**UI changes**:
- `app/accounting-export/admin/page.tsx`:
  - Added separate input fields for `owner_label` and `department_label` in the bulk-edit form
  - Both fields are optional (users can set owner without department, or vice versa)

- `app/settings/tiktok/page.tsx`:
  - Added "Resync TikTok account names" button
  - Shows spinner during resync, displays result count on success

**Verification**:
- Build: ✓ clean
- TypeScript: ✓ zero errors
- ESLint: ✓ no new warnings
- Code review: ✓ approved (race condition mitigation confirmed)
- Unit tests: ✓ passing (RPC function tested via direct SQL call)

## Critical Operational Fact

**Two manual Supabase SQL steps are now appended to `supabase/schema.sql` and HAVE NOT been run against the live database:**

1. The `ALTER TABLE account_owners ADD COLUMN department_label TEXT;` migration
2. The `CREATE OR REPLACE FUNCTION upsert_account_owner_label(...)` RPC function definition

**Until both are deployed to the live Supabase database**, any PATCH to `/api/account-owners` will fail with a 500 error (column doesn't exist, or RPC function not found). The tool will not accept owner/department edits until the schema is live.

Deployment checklist:
1. Copy both SQL blocks from `supabase/schema.sql` (look for comments flagging the two new blocks)
2. Run in Supabase SQL editor (same manual process as the initial `account_owners` table deployment from yesterday)
3. Verify `account_owners` table now has `department_label` column (run: `SELECT column_name FROM information_schema.columns WHERE table_name='account_owners';`)
4. Verify `upsert_account_owner_label()` function exists (run: `SELECT proname FROM pg_proc WHERE proname='upsert_account_owner_label';`)
5. Deploy app code

## What We Tried

1. **Atomic RPC approach**: Addressed race condition by moving business logic into database (PL/pgSQL transaction), ensuring both columns update together or fail together.

2. **Non-destructive resync**: Instead of full disconnect → reconnect (which wipes preferences), new action re-fetches names only and patches stored rows, preserving `is_selected` state.

3. **Idempotent update pattern**: PATCH `/api/account-owners` uses conflict detection; retries are safe (duplicate requests resolve to same state).

## Root Cause Analysis

**Why the race condition in owner/department existed**: Original plan treated `owner_label` as a single concatenated field (e.g., "John Doe | Finance Department"). This required atomic updates to avoid corruption. SQL UPDATE statements are atomic at the row level, but not at the column level when two values are managed by the same endpoint. If one column update succeeds and another fails (e.g., due to network timeout), data corrupts silently. RPC functions run as a single transaction, solving this.

**Why TikTok advertiser names went stale**: Chunking logic in `lib/tiktok/accounts.ts` (fixed in `2aed53f`) had an off-by-one error in the loop that splits 1000 advertiser IDs into 100-per-request chunks. One chunk was being silently skipped. Initial sync appeared to succeed (return 200) but rows for that chunk contained raw IDs. Users didn't notice until they opened Settings.

## Lessons Learned

1. **Concurrent column updates need atomic transactions**: Row-level atomicity is not enough when the endpoint logic depends on consistent state across multiple columns. Push column-update logic into the database (stored procedures) to ensure atomicity.

2. **Data migration recovery pathways matter operationally**: If a sync fails mid-process, provide a non-destructive resync action instead of forcing users to redo the entire sync (which may wipe configuration state). Preserve user state, fix only the data gap.

3. **Chunking bugs are silent failures**: Bulk API calls split into chunks are a common source of logic bugs (off-by-one, missing error handling in the loop). Every chunk operation needs explicit logging and result aggregation to surface partial failures.

## Next Steps

1. **Immediate** (deployment prerequisite, same as previous session):
   - Run Supabase schema migrations: copy BOTH SQL blocks from `supabase/schema.sql` (department_label column + upsert_account_owner_label RPC), paste into Supabase SQL editor, execute
   - Verify both schema changes applied
   - Deploy code

2. **Post-deployment validation**:
   - Test owner management panel with both fields (verify PATCH `/api/account-owners` succeeds with owner_label and/or department_label)
   - Test TikTok resync action (Settings > "Resync TikTok account names", verify names update and `is_selected` state persists)
   - Test concurrent owner edits (two admins edit same account simultaneously; verify race condition is mitigated)
   - Verify export groups rows correctly by owner and department

3. **Communication**:
   - Alert operators: TikTok users can now resync account names from Settings (self-service fix for raw IDs issue)
   - Document the two manual SQL steps in deployment runbook

## Unresolved Questions / Open Items

- Both Supabase schema migrations must be run manually before production deployment (see Immediate steps above)
- TikTok resync behavior under edge cases (e.g., TikTok API returns fewer advertisers than before) — current code updates matching rows, leaves orphaned rows alone; no validation of row count changes
- Concurrent PATCH handling: RPC conflict detection uses a simple timestamp check; high-contention scenarios (10+ simultaneous admins) not tested

**Files created**: None  
**Files modified**: 
- `app/api/account-owners/route.ts` (added RPC call, updated request body handling)
- `app/api/tiktok/accounts/route.ts` (added action:'resync_names' handler)
- `app/accounting-export/admin/page.tsx` (split owner/department inputs)
- `app/settings/tiktok/page.tsx` (added resync button)
- `supabase/schema.sql` (appended: department_label column + upsert_account_owner_label RPC function)

**Branch**: master — all changes committed; schema migrations not yet run against live Supabase (manual deployment step)
