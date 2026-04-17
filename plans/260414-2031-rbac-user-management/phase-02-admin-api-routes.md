# Phase 2 — Admin API Routes

## Context
- [Phase 1](phase-01-database-schema.md) must be complete (role column + team_members table)
- [Current API pattern](../../app/api/settings/route.ts) — auth check, service client, error helpers

## Overview
- **Priority:** P1
- **Status:** pending
- **Depends on:** Phase 1
- **Description:** Create admin-only API routes for user management (list users, change roles, manage team assignments).

## Key Insights
- All routes use service client (bypasses RLS) after verifying caller is admin
- Admin check pattern: get user via cookie client -> load role via service client -> reject if not admin
- Extract a shared `requireAdmin()` helper to avoid repeating auth+role check in every route

## Requirements

### Functional
- `GET /api/admin/users` — list all users with email, role, created_at
- `PATCH /api/admin/users/[userId]` — update a user's role
- `GET /api/admin/team` — list all team assignments (leader->staff pairs)
- `POST /api/admin/team` — assign staff to leader
- `DELETE /api/admin/team` — remove staff from leader

### Non-Functional
- All routes return 403 if caller is not admin
- Role changes validated against allowed values
- Cannot demote yourself from admin (safety guard)

## Architecture

### Data Flow
```
Request -> cookie auth (get user.id) -> service client (get role) -> reject if !admin
  -> service client performs query -> JSON response
```

### Shared Helper: `lib/auth-guards.ts`
```typescript
export async function requireAdmin(): Promise<{ userId: string } | Response>
// Returns userId if admin, or a 401/403 Response to short-circuit
```

## Related Code Files

### Create
- `lib/auth-guards.ts` — requireAdmin() helper
- `app/api/admin/users/route.ts` — GET all users
- `app/api/admin/users/[userId]/route.ts` — PATCH role
- `app/api/admin/team/route.ts` — GET/POST/DELETE team assignments

### Read (for reference)
- `app/api/settings/route.ts` — existing auth pattern
- `lib/supabase/server.ts` — createClient, createServiceClient
- `lib/utils.ts` — errorResponse helper

## Implementation Steps

### Step 1: Create `lib/auth-guards.ts`

```typescript
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import type { UserRole } from '@/lib/types';

export async function requireRole(allowedRoles: UserRole[]) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: errorResponse('Unauthorized', 401) };

  const service = createServiceClient();
  const { data: profile } = await service
    .from('profiles').select('role').eq('id', user.id).single();

  const role = (profile as { role: UserRole } | null)?.role ?? 'staff';
  if (!allowedRoles.includes(role)) return { error: errorResponse('Forbidden', 403) };

  return { userId: user.id, role };
}

export async function requireAdmin() {
  return requireRole(['admin']);
}
```

### Step 2: Create `app/api/admin/users/route.ts`

GET handler:
- Call requireAdmin()
- Query `auth.users` joined with profiles to get email + role
- Actually: use service client to query profiles, then `supabase.auth.admin.listUsers()` for emails
- Simpler: add `email` and `display_name` to profiles table? No — keep profiles lean. Use Supabase admin API.
- **Decision:** Query profiles for role, query `auth.admin.listUsers()` for email/metadata. Merge client-side in API.

```typescript
// GET /api/admin/users
const auth = await requireAdmin();
if ('error' in auth) return auth.error;

const service = createServiceClient();
const { data: profiles } = await service.from('profiles').select('id, role, updated_at');
const { data: { users } } = await service.auth.admin.listUsers();

// Merge: attach role from profiles to each auth user
const merged = users.map(u => ({
  id: u.id,
  email: u.email,
  role: profiles?.find(p => p.id === u.id)?.role ?? 'staff',
  created_at: u.created_at,
}));
```

### Step 3: Create `app/api/admin/users/[userId]/route.ts`

PATCH handler:
- Call requireAdmin()
- Validate body: `{ role: 'admin' | 'leader' | 'staff' }`
- Prevent self-demotion: if userId === auth.userId and new role !== 'admin', reject
- Update profiles.role via service client

### Step 4: Create `app/api/admin/team/route.ts`

GET handler:
- requireAdmin()
- Select all from team_members joined with profiles for names/emails

POST handler: `{ leader_id, staff_id }`
- requireAdmin()
- Validate both users exist and leader has role='leader'
- Insert into team_members

DELETE handler: `{ leader_id, staff_id }`
- requireAdmin()
- Delete from team_members matching the pair

## Todo List
- [ ] Create `lib/auth-guards.ts` with requireRole/requireAdmin
- [ ] Create `app/api/admin/users/route.ts` (GET)
- [ ] Create `app/api/admin/users/[userId]/route.ts` (PATCH)
- [ ] Create `app/api/admin/team/route.ts` (GET/POST/DELETE)
- [ ] Test: non-admin gets 403 on all admin routes
- [ ] Test: admin can list users, change roles, manage teams
- [ ] Test: self-demotion blocked

## Success Criteria
- `GET /api/admin/users` returns all users with roles (admin caller only)
- `PATCH /api/admin/users/:id` changes role in DB
- Team assignment CRUD works; duplicates rejected by PK constraint
- All routes return 403 for non-admin callers

## Security Considerations
- **Auth check is double-layered:** cookie-based user auth + DB role check
- **Service client used after auth:** never exposed to client
- **Self-demotion guard:** prevents locking yourself out
- **Input validation:** role must be in allowed enum; user IDs must exist
- **No token exposure:** admin routes never return fb_access_token
