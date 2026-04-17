# Phase 1 — Database Schema

## Context
- [Current schema](../../supabase/schema.sql) — profiles + fb_ad_accounts tables
- [Types](../../lib/types.ts) — UserProfile, FbAdAccount interfaces

## Overview
- **Priority:** P1 (blocker for all other phases)
- **Status:** pending
- **Description:** Add `role` column to `profiles`, create `team_members` join table, update trigger and RLS policies, update TypeScript types.

## Key Insights
- `profiles` already has RLS with "users read/update own row" — admin needs service client, not new RLS policies for admin reads
- `handle_new_user()` trigger must set `role = 'staff'` for new signups
- `team_members` needs a unique constraint on (leader_id, staff_id) to prevent duplicates
- Admin routes will use service client (bypasses RLS), so no admin-specific RLS policies needed on profiles

## Requirements

### Functional
- `profiles.role` column: text, default `'staff'`, constrained to `('admin','leader','staff')`
- `team_members` table: leader_id (uuid FK profiles), staff_id (uuid FK profiles), created_at
- Existing users get `'staff'` role automatically (column default)
- New users get `'staff'` via updated trigger

### Non-Functional
- Migration must be idempotent (IF NOT EXISTS / safe ALTER)
- No downtime — additive changes only

## Architecture

```
profiles
  + role text NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','leader','staff'))

team_members (NEW)
  leader_id uuid FK -> profiles(id) ON DELETE CASCADE
  staff_id  uuid FK -> profiles(id) ON DELETE CASCADE
  created_at timestamptz DEFAULT now()
  PK (leader_id, staff_id)
  CHECK (leader_id != staff_id)
```

### RLS for team_members
- Leaders can SELECT rows where `leader_id = auth.uid()`
- All mutations go through service client in admin API routes — no insert/update/delete RLS needed for regular users
- Enable RLS but keep mutations admin-only via service client

## Related Code Files

### Modify
- `supabase/schema.sql` — add role column, team_members table, RLS policies
- `lib/types.ts` — add `UserRole` type, update `UserProfile`, add `TeamMember`

### Create
- None (schema changes go in existing file)

## Implementation Steps

1. Add `role` column to `profiles` table in schema.sql:
   ```sql
   ALTER TABLE public.profiles
     ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'staff'
     CHECK (role IN ('admin', 'leader', 'staff'));
   ```

2. Update `handle_new_user()` trigger to include role default:
   ```sql
   insert into public.profiles (id, role) values (new.id, 'staff')
   ```

3. Create `team_members` table:
   ```sql
   CREATE TABLE IF NOT EXISTS public.team_members (
     leader_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
     staff_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
     created_at timestamptz DEFAULT now(),
     PRIMARY KEY (leader_id, staff_id),
     CHECK (leader_id != staff_id)
   );
   ```

4. Enable RLS on `team_members` with leader SELECT policy:
   ```sql
   ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "Leaders can read own team"
     ON public.team_members FOR SELECT
     USING (auth.uid() = leader_id);
   ```

5. Update `lib/types.ts`:
   ```typescript
   export type UserRole = 'admin' | 'leader' | 'staff';

   export interface UserProfile {
     id: string;
     fb_access_token: string | null;
     role: UserRole;
     created_at: string;
   }

   export interface TeamMember {
     leader_id: string;
     staff_id: string;
     created_at: string;
   }
   ```

## Todo List
- [ ] Add `role` column to profiles with CHECK constraint
- [ ] Update `handle_new_user()` trigger
- [ ] Create `team_members` table with PK and CHECK
- [ ] Add RLS policy for team_members (leader SELECT)
- [ ] Update UserProfile interface in types.ts
- [ ] Add UserRole type and TeamMember interface
- [ ] Run migration in Supabase SQL editor
- [ ] Verify existing users have role='staff'

## Success Criteria
- `SELECT role FROM profiles` returns 'staff' for all existing users
- New user signup creates profile with role='staff'
- `team_members` table accepts valid pairs, rejects self-reference
- TypeScript types compile without errors

## Security Considerations
- CHECK constraint prevents invalid role values at DB level
- RLS on team_members prevents staff from seeing team assignments
- Admin mutations use service client — no RLS bypass needed
- CASCADE delete ensures cleanup when users are removed

## Next Steps
- Phase 2 (Admin API) and Phase 3 (Leader API) can start once schema is deployed
