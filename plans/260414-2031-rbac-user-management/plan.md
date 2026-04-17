---
title: "RBAC: Admin, Leader, Staff Roles"
description: "Add role-based access control with admin user management and leader view-as-staff capability"
status: pending
priority: P1
effort: 10h
branch: feat/rbac-user-management
tags: [rbac, auth, supabase, admin, leader]
created: 2026-04-14
---

# RBAC User Management

## Data Flow

```
profiles.role (admin|leader|staff) --> API route checks --> UI gating
team_members (leader_id, staff_id) --> leader sees staff list --> viewAs param --> staff's token used server-side
```

## Phases

| # | Phase | Status | Effort | Files Touched |
|---|-------|--------|--------|---------------|
| 1 | [Database Schema](phase-01-database-schema.md) | pending | 1h | supabase/schema.sql, lib/types.ts |
| 2 | [Admin API Routes](phase-02-admin-api-routes.md) | pending | 2h | app/api/admin/\*\*/route.ts |
| 3 | [Leader API Routes](phase-03-leader-api-routes.md) | pending | 2h | app/api/leader/staff/route.ts, app/api/campaigns/route.ts, app/api/settings/route.ts |
| 4 | [Admin UI](phase-04-admin-ui.md) | pending | 3h | app/admin/\*\* |
| 5 | [Leader Dashboard](phase-05-leader-dashboard.md) | pending | 2h | app/dashboard/page.tsx, app/dashboard/components/campaign-hub.tsx |

## Dependency Graph

```
Phase 1 (schema) --> Phase 2 (admin API) --> Phase 4 (admin UI)
Phase 1 (schema) --> Phase 3 (leader API) --> Phase 5 (leader dashboard)
Phase 2 + Phase 3 can run in parallel after Phase 1
Phase 4 + Phase 5 can run in parallel after their API phases
```

## Risk Assessment

| Risk | L x I | Mitigation |
|------|-------|------------|
| Token leak via viewAs | Low x Critical | Server-side only; token never in response body; validate relationship in DB |
| Role escalation | Low x Critical | Service client checks role from DB, never trusts client-sent role |
| Breaking existing staff UX | Med x High | Staff flow unchanged; role defaults to 'staff'; no migration needed |
| RLS policy conflicts | Low x Med | New policies are additive; admin routes use service client |

## Rollback Plan

- Phase 1: `ALTER TABLE profiles DROP COLUMN role; DROP TABLE team_members;`
- Phase 2-5: Delete new route/page files; revert modified files via git

## Backwards Compatibility

- Existing users get `role = 'staff'` (column default). Zero UX change for them.
- No existing API contracts broken. `viewAs` is an optional additive param.
- `handle_new_user()` trigger updated to set default role.

## Test Matrix

| Layer | What | How |
|-------|------|-----|
| Unit | Role guard helper | Assert admin/leader/staff access patterns |
| Integration | viewAs param | Verify leader can fetch staff campaigns, staff cannot use viewAs |
| Integration | Admin CRUD | Create/update roles, assign/remove team members |
| E2E | Admin page | Role changes reflected, team assignment works |
| E2E | Leader switcher | Staff dropdown loads correct campaigns |
