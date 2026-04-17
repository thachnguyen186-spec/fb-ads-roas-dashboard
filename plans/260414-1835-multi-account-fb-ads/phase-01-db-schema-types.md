# Phase 1 — DB Schema + Types

## Context Links
- [Current schema](../../supabase/schema.sql)
- [Current types](../../lib/types.ts)

## Overview
- **Priority:** P1 (blocker for all other phases)
- **Status:** Pending
- **Description:** Create `fb_accounts` table with RLS and add `FbAccount` TypeScript type

## Key Insights
- Current `profiles` table stores credentials inline — new table normalizes to 1:N
- Service client bypasses RLS in API routes, but RLS still needed for direct Supabase client access
- `profiles` columns left untouched — no destructive migration

## Requirements

### Functional
- `fb_accounts` table: id (uuid PK), user_id (FK → auth.users), label (text), fb_ad_account_id (text), fb_access_token (text), created_at (timestamptz)
- RLS: users can only CRUD their own rows
- Unique constraint on (user_id, fb_ad_account_id) to prevent duplicate accounts

### Non-functional
- Migration is additive only (no ALTER on existing tables)

## Architecture

```
auth.users
  └── profiles (1:1, existing — unchanged)
  └── fb_accounts (1:N, new)
        ├── id: uuid default gen_random_uuid()
        ├── user_id: uuid references auth.users(id) on delete cascade
        ├── label: text not null
        ├── fb_ad_account_id: text not null
        ├── fb_access_token: text not null
        └── created_at: timestamptz default now()
```

## Related Code Files

### Modify
- `supabase/schema.sql` — append fb_accounts table + RLS policies
- `lib/types.ts` — add FbAccount interface

### Create
- None

### Delete
- None

## Implementation Steps

### 1. Add fb_accounts table to schema.sql

Append after existing profiles section:

```sql
-- fb_accounts table: multiple FB ad accounts per user
create table if not exists public.fb_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  fb_ad_account_id text not null,
  fb_access_token text not null,
  created_at timestamptz default now(),
  unique(user_id, fb_ad_account_id)
);

-- RLS
alter table public.fb_accounts enable row level security;

create policy "Users can read own fb_accounts"
  on public.fb_accounts for select
  using (auth.uid() = user_id);

create policy "Users can insert own fb_accounts"
  on public.fb_accounts for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own fb_accounts"
  on public.fb_accounts for delete
  using (auth.uid() = user_id);
```

No UPDATE policy — accounts are add/remove only. To change credentials, delete and re-add.

### 2. Add FbAccount type to lib/types.ts

```typescript
/** FB ad account stored in fb_accounts table */
export interface FbAccount {
  id: string;
  label: string;
  fb_ad_account_id: string;
  created_at: string;
}
```

Note: `fb_access_token` intentionally excluded from the type — tokens never sent to client. A separate `FbAccountWithToken` type is not needed; API routes cast the DB row inline.

## Todo List

- [ ] Append fb_accounts DDL to supabase/schema.sql
- [ ] Run SQL in Supabase dashboard to create table
- [ ] Add FbAccount interface to lib/types.ts
- [ ] Verify table created with correct columns and RLS via Supabase dashboard

## Success Criteria
- `fb_accounts` table exists with correct columns and constraints
- RLS policies enforce user_id = auth.uid()
- `FbAccount` type exported from lib/types.ts
- TypeScript compiles without errors

## Risk Assessment
| Risk | Mitigation |
|------|------------|
| Schema drift between file and actual DB | Always run schema.sql changes in Supabase dashboard manually |
| Unique constraint too strict (same account, different tokens) | Constraint is on (user_id, fb_ad_account_id) — user can update by delete+re-add |

## Security Considerations
- RLS enabled with per-user policies
- No UPDATE policy — prevents token modification attacks; forces delete+re-add flow
- Tokens stored plaintext (same as current profiles pattern)

## Next Steps
- Phase 2 depends on this table existing
