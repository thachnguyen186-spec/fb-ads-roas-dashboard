# Phase 01 — DB Schema + TypeScript Types

## Context Links
- Schema file: `supabase/schema.sql`
- Types file: `lib/types.ts`
- Existing pattern: `fb_ad_accounts` table at `supabase/schema.sql:42-65`

## Overview
- **Priority:** P0 (blocker for 03, 04)
- **Status:** completed
- **Description:** Add two columns to `public.fb_ad_accounts` (`alert_threshold`, `alert_sent`) and extend the `FbAdAccount` TypeScript type. Idempotent — safe to re-run.

## Key Insights
- Existing rows in `fb_ad_accounts` must remain valid → both columns nullable / defaulted.
- `alert_threshold` stored as `numeric` (not int) → VND can be huge but still numeric; USD cents are integers but numeric works for both.
- `alert_sent` defaults `false` so existing rows immediately participate in cron without manual backfill.
- RLS policy on table is already `for all` (line 61-64), no policy changes needed.

## Requirements
- `alert_threshold numeric null` — stored in FB-native unit (USD cents or VND units). `null` = alerting disabled for this account.
- `alert_sent boolean not null default false` — cron-managed dedup flag.
- Type extension: add both fields as optional in `FbAdAccount`.

## Architecture
Single-table change. No new tables, no new policies, no triggers.

## Related Code Files
**Modify:**
- `supabase/schema.sql` (append migration block at end of fb_ad_accounts section)
- `lib/types.ts` (extend `FbAdAccount` interface)

**Create:** none.

## Implementation Steps

1. Append migration block to `supabase/schema.sql` after the existing `currency` alter block:
   ```sql
   -- ─── spending limit monitor: per-account alert threshold + dedup flag ─────────
   -- Run in Supabase SQL editor to enable the Spending Limit Monitor tool.
   alter table public.fb_ad_accounts
     add column if not exists alert_threshold numeric;

   alter table public.fb_ad_accounts
     add column if not exists alert_sent boolean not null default false;

   -- Optional: index for cron scan (only useful at >10k accounts; skip for now per YAGNI)
   ```

2. Run the migration in Supabase SQL editor (manual step — document in plan, not automated).

3. Extend `FbAdAccount` in `lib/types.ts`:
   ```typescript
   export interface FbAdAccount {
     account_id: string;
     name: string;
     is_selected: boolean;
     account_status: number | null;
     currency: string;
     /** Threshold in account's native FB unit (USD cents, VND units). null = alerts disabled. */
     alert_threshold?: number | null;
     /** Cron-managed: true after alert sent for current crossing, reset when remaining recovers. */
     alert_sent?: boolean;
   }
   ```

4. Verify no existing `select('account_id,name,is_selected,...')` calls break — TypeScript will catch since new fields are optional.

## Todo List
- [x] Append SQL block to `supabase/schema.sql`
- [x] Run SQL in Supabase SQL editor
- [x] Verify columns via `select column_name from information_schema.columns where table_name='fb_ad_accounts'`
- [x] Update `FbAdAccount` interface in `lib/types.ts`
- [x] Run `tsc --noEmit` to confirm no type breakage

## Success Criteria
- `\d public.fb_ad_accounts` (psql) shows both columns with correct types/defaults.
- Re-running migration produces no error.
- `npx tsc --noEmit` passes.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Migration fails on existing prod table | Low | Med | `if not exists` guards; columns are pure additions |
| Type changes break `select` calls expecting exact shape | Low | Low | Optional fields; existing selects ignore unknown cols |

## Security Considerations
- No new PII. Threshold + boolean only.
- RLS already restricts to `auth.uid() = user_id`. Cron uses service client → bypasses RLS intentionally.

## Next Steps
- Phase 02 can start immediately (does not depend on this phase's runtime data, only on the type).
- Phase 03 depends on this for the PATCH route's column write.
