# Phase 01 — SQL migration: per-user TikTok tables (additive)

## Context Links
- `supabase/schema.sql` lines ~134-160 (old singleton + advertiser tables), ~45-64 (`fb_ad_accounts` pattern)
- Plan: [plan.md](./plan.md)

## Overview
- Priority: P1 (blocks everything). Status: code done, SQL run pending. Effort: 1h.
- Create two new tables, copy singleton data into the admin's personal rows. Old tables untouched (dropped in Phase 7).

## Key Insights
- New tables (not in-place ALTER) because old code upserts `onConflict: 'advertiser_id'` / `id` — changing PKs in place would break the live app between SQL run and deploy.
- `profiles` has no `created_at`, so there is no safe "first admin" fallback; if `connected_by` is null the migration skips with a NOTICE (admin reconnects once).
- `account_owners` stays keyed `(account_id, platform)` — owner label is per advertiser, org-wide. No change.

## Requirements
- Idempotent, runnable whole in Supabase SQL editor, re-runnable after Phase 7 drop (guards via `to_regclass`).
- Tokens service-role only: RLS enabled, NO policies on both new tables.
- `on delete cascade` from `auth.users` (deleting a user removes their TikTok token + rows).

## Architecture — data flow
```
tiktok_connection (id=true, connected_by=ADMIN) ──copy──> tiktok_connections (user_id=ADMIN)
tiktok_advertiser_accounts (advertiser_id,…,is_selected) ──copy, user_id=ADMIN──> tiktok_ad_accounts
```

## SQL (append to `supabase/schema.sql` directly after the old `tiktok_advertiser_accounts` block)
```sql
-- ─── TikTok Ads: PER-USER connections (plan 261012-1101) ─────────────────────
-- Idempotent. Additive: safe to run while the old org-wide code is still deployed.
-- RLS enabled with NO policies on both tables: service-role client only (tokens).
create table if not exists public.tiktok_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,                 -- null for long-term Marketing API tokens
  token_expires_at timestamptz,       -- null = never expires (only revocable)
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tiktok_connections enable row level security;

create table if not exists public.tiktok_ad_accounts (
  advertiser_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  currency text not null default 'USD',
  is_selected boolean not null default true,
  primary key (advertiser_id, user_id)
);
create index if not exists tiktok_ad_accounts_user_id_idx on public.tiktok_ad_accounts (user_id);
alter table public.tiktok_ad_accounts enable row level security;

-- One-time data move: org-wide singleton -> connected_by's personal rows. Re-runnable.
do $$
declare v_owner uuid;
begin
  if to_regclass('public.tiktok_connection') is null then
    raise notice 'tiktok_connection not present - nothing to migrate';
    return;
  end if;
  -- Durable run-once marker (old code ignores the column): re-running this file must not
  -- resurrect a token the admin later disconnected, or advertiser rows a sync removed.
  execute 'alter table public.tiktok_connection add column if not exists migrated_per_user_at timestamptz';
  if exists (select 1 from public.tiktok_connection where id and migrated_per_user_at is not null) then
    raise notice 'tiktok_connection already migrated - skipped';
    return;
  end if;
  select connected_by into v_owner from public.tiktok_connection
   where id and access_token is not null;
  if v_owner is null then
    raise notice 'No singleton token or connected_by is null - skipped (admin reconnects)';
    return;
  end if;
  insert into public.tiktok_connections (user_id, access_token, refresh_token, token_expires_at, connected_at, updated_at)
  -- No refresh_token = long-term token; the old row's expiry was a guessed 24h, so drop it.
  select v_owner, access_token, refresh_token,
         case when refresh_token is null then null else token_expires_at end,
         coalesce(connected_at, now()), coalesce(updated_at, now())
    from public.tiktok_connection where id
  on conflict (user_id) do nothing;
  if to_regclass('public.tiktok_advertiser_accounts') is not null then
    insert into public.tiktok_ad_accounts (advertiser_id, user_id, name, currency, is_selected)
    select advertiser_id, v_owner, name, currency, is_selected
      from public.tiktok_advertiser_accounts
    on conflict (advertiser_id, user_id) do nothing;
  end if;
  update public.tiktok_connection set migrated_per_user_at = now() where id;
end $$;
```

> **Revision (code review H1, L2):** the run-once marker `migrated_per_user_at` (added to the old `tiktok_connection` table) makes re-runs no-ops, so a disconnected token is not resurrected. The expiry is nulled when there is no `refresh_token`. `supabase/schema.sql` is the source of truth; this snippet mirrors it.

## Related Code Files
- Modify: `supabase/schema.sql` (append block above; do NOT touch old blocks yet)
- Create/Delete: none

## Implementation Steps
1. Pre-check in SQL editor: `select connected_by, token_expires_at, refresh_token is not null as has_rt from tiktok_connection;` — confirm `connected_by` is the intended admin uuid (`select id, role from profiles where id = '<uuid>'`).
2. Append block to `schema.sql`.
3. Run the block in Supabase SQL editor. Run it a second time to prove idempotency (no errors, no dup rows).
4. Verify: `select user_id, connected_at from tiktok_connections;` (1 row = admin) and `select count(*), count(*) filter (where is_selected) from tiktok_ad_accounts;` equals old table counts.

## Todo List
- [ ] Pre-check `connected_by`
- [x] Append SQL to schema.sql
- [ ] Run twice in Supabase, verify counts match old tables

## Success Criteria
- Both tables exist with RLS on and zero policies (`select * from pg_policies where tablename in ('tiktok_connections','tiktok_ad_accounts')` -> 0 rows).
- Row counts match old tables; second run is a no-op.
- Live (old) app still works unchanged.

## Risk Assessment
| Risk | L x I | Mitigation |
|------|-------|-----------|
| `connected_by` null / wrong user | L x M | Pre-check step 1; NOTICE + skip; admin reconnects |
| Old code breaks | L x H | Purely additive, old tables untouched |
| Re-run duplicates | L x L | PKs + `on conflict do nothing` |

## Security Considerations
- No policies = anon/authenticated JWTs denied; only `createServiceClient()` reads tokens.
- FK cascade ensures deleted users' tokens disappear.

## Rollback
`drop table if exists public.tiktok_ad_accounts; drop table if exists public.tiktok_connections;` — old app unaffected.

## Next Steps
Phase 2 switches the lib to the new tables.
