# Phase 4 — Admin UI

## Context
- [Admin API routes](phase-02-admin-api-routes.md) must be complete
- [Dashboard layout](../../app/dashboard/components/campaign-hub.tsx) — reference for UI patterns

## Overview
- **Priority:** P2
- **Status:** pending
- **Depends on:** Phase 2 (admin API routes)
- **Description:** Build `/admin` page with user management table: list users, change roles, assign/remove staff-to-leader relationships.

## Key Insights
- Admin page is server-component gated: check role on server, redirect non-admins
- User table is client component for interactivity (role dropdowns, team assignment)
- Keep it simple: single page with two sections — Users table + Team assignments
- Use existing Tailwind patterns from dashboard for consistency

## Requirements

### Functional
- Server-side role check: redirect to /dashboard if not admin
- User list table: columns = email, role (dropdown), actions
- Role change: dropdown triggers PATCH, optimistic update
- Team section: show current leader->staff assignments
- Assign staff: select leader + select staff -> POST
- Remove assignment: delete button per row

### Non-Functional
- Page must not be accessible by non-admins (server redirect)
- Role changes reflect immediately in UI
- Error states shown inline (toast or alert)

## Architecture

### Component Tree
```
app/admin/page.tsx (server component — auth gate)
  -> AdminDashboard (client component — data fetching + state)
    -> UserTable (client component — role dropdowns)
    -> TeamManager (client component — assignment CRUD)
```

### Data Flow
```
page.tsx: check role server-side -> redirect if !admin -> render AdminDashboard
AdminDashboard: fetch /api/admin/users + /api/admin/team on mount
UserTable: PATCH /api/admin/users/:id on role change
TeamManager: POST/DELETE /api/admin/team on assign/remove
```

## Related Code Files

### Create
- `app/admin/page.tsx` — server component with auth gate
- `app/admin/components/admin-dashboard.tsx` — client component orchestrator
- `app/admin/components/user-table.tsx` — user list with role dropdowns
- `app/admin/components/team-manager.tsx` — team assignment UI

### Read (for reference)
- `app/dashboard/page.tsx` — server auth pattern
- `app/dashboard/components/campaign-hub.tsx` — client component patterns

## Implementation Steps

### Step 1: Create `app/admin/page.tsx`

```tsx
import { redirect } from 'next/navigation';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import AdminDashboard from './components/admin-dashboard';

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const service = createServiceClient();
  const { data: profile } = await service
    .from('profiles').select('role').eq('id', user.id).single();

  if (profile?.role !== 'admin') redirect('/dashboard');

  return <AdminDashboard />;
}
```

### Step 2: Create `app/admin/components/admin-dashboard.tsx`

- Client component with useEffect to fetch users + team data
- Pass data down to UserTable and TeamManager
- Handle loading/error states

### Step 3: Create `app/admin/components/user-table.tsx`

- Table with columns: Email, Role (select dropdown), Updated At
- On role change: `PATCH /api/admin/users/${userId}` with `{ role }`
- Disable role dropdown for the current admin user (prevent self-demotion via UI)
- Show success/error feedback inline

### Step 4: Create `app/admin/components/team-manager.tsx`

- Section heading: "Team Assignments"
- Table of current assignments: Leader Email | Staff Email | Remove button
- Add form: two dropdowns (leaders, staff) + Assign button
- Leader dropdown filtered to users with role='leader'
- Staff dropdown filtered to users with role='staff'
- On assign: POST /api/admin/team
- On remove: DELETE /api/admin/team

## Todo List
- [ ] Create `app/admin/page.tsx` with server-side auth gate
- [ ] Create `app/admin/components/admin-dashboard.tsx`
- [ ] Create `app/admin/components/user-table.tsx` with role editing
- [ ] Create `app/admin/components/team-manager.tsx`
- [ ] Add /admin link in dashboard header (visible only to admin)
- [ ] Test: non-admin redirected to /dashboard
- [ ] Test: role changes persist after refresh
- [ ] Test: team assignment create/delete works

## Success Criteria
- `/admin` accessible only to admin role users
- Non-admin navigating to /admin gets redirected to /dashboard
- User list shows all users with current roles
- Role dropdown changes trigger API call and update UI
- Team assignments table shows leader-staff pairs
- New assignments can be created; existing ones removed

## Security Considerations
- **Server-side gate:** Role check happens in server component, not just client
- **No client-side role spoofing:** API routes independently verify admin role
- **Self-demotion blocked:** Both UI (disabled dropdown) and API (403) prevent it
- **fb_access_token never fetched:** Admin API returns id, email, role only
