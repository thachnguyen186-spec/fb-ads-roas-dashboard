# Phase 3 — Leader API Routes

## Context
- [Phase 1](phase-01-database-schema.md) must be complete
- [Auth guards](phase-02-admin-api-routes.md) — reuse requireRole() from Phase 2
- [Campaigns route](../../app/api/campaigns/route.ts) — needs viewAs support
- [Settings route](../../app/api/settings/route.ts) — needs role in response

## Overview
- **Priority:** P1
- **Status:** pending
- **Depends on:** Phase 1 (schema), Phase 2 (auth-guards.ts)
- **Description:** Add leader's staff list endpoint, viewAs param to campaigns route, and role info to settings response.

## Key Insights
- **Token never leaves server:** viewAs loads staff's token server-side, uses it for FB API call, returns campaign data only
- Leader must have a team_members row linking to the staff they're viewing
- Admin can viewAs any user (no relationship check needed)
- Settings GET should return role so the client knows what UI to render

## Requirements

### Functional
- `GET /api/leader/staff` — returns list of staff assigned to current leader
- `GET /api/campaigns?accountId=X&viewAs=userId` — leader/admin can load staff's campaigns
- `GET /api/settings` — include `role` field in response

### Non-Functional
- viewAs rejects if caller lacks permission (not leader/admin, or no team relationship)
- Staff users cannot use viewAs param

## Architecture

### viewAs Data Flow
```
Leader requests /api/campaigns?accountId=X&viewAs=staffId
  -> auth: get caller user.id
  -> service: get caller role from profiles
  -> if role=leader: verify team_members(leader_id=caller, staff_id=viewAs) exists
  -> if role=admin: skip relationship check
  -> if role=staff: reject 403
  -> service: load staff's fb_access_token from profiles
  -> service: verify accountId belongs to staff in fb_ad_accounts
  -> fetchCampaigns(staffToken, accountId)
  -> return campaigns (token never in response)
```

## Related Code Files

### Modify
- `app/api/campaigns/route.ts` — add viewAs query param handling
- `app/api/settings/route.ts` — add role to GET response

### Create
- `app/api/leader/staff/route.ts` — GET staff list for current leader

### Read (for reference)
- `lib/auth-guards.ts` — requireRole (from Phase 2)
- `lib/facebook/campaigns.ts` — fetchCampaigns function

## Implementation Steps

### Step 1: Create `app/api/leader/staff/route.ts`

```typescript
// GET /api/leader/staff
const auth = await requireRole(['leader', 'admin']);
if ('error' in auth) return auth.error;

const service = createServiceClient();

if (auth.role === 'admin') {
  // Admin sees all staff with their leaders
  const { data } = await service
    .from('team_members')
    .select('leader_id, staff_id');
  // Also fetch user emails via auth.admin.listUsers()
  // Return merged list
}

// Leader: get own team
const { data: team } = await service
  .from('team_members')
  .select('staff_id')
  .eq('leader_id', auth.userId);

// Fetch staff profiles/emails for display
const staffIds = team?.map(t => t.staff_id) ?? [];
const { data: { users } } = await service.auth.admin.listUsers();
const staffUsers = users
  .filter(u => staffIds.includes(u.id))
  .map(u => ({ id: u.id, email: u.email }));

return Response.json({ staff: staffUsers });
```

### Step 2: Modify `app/api/campaigns/route.ts`

Add viewAs support after existing auth check:

```typescript
const viewAsId = request.nextUrl.searchParams.get('viewAs');

let targetUserId = user.id;

if (viewAsId) {
  // Load caller's role
  const { data: callerProfile } = await service
    .from('profiles').select('role').eq('id', user.id).single();
  const callerRole = callerProfile?.role ?? 'staff';

  if (callerRole === 'staff') return errorResponse('Forbidden', 403);

  if (callerRole === 'leader') {
    // Verify team relationship
    const { data: rel } = await service
      .from('team_members')
      .select('staff_id')
      .eq('leader_id', user.id)
      .eq('staff_id', viewAsId)
      .single();
    if (!rel) return errorResponse('Staff member not in your team', 403);
  }
  // Admin skips relationship check
  targetUserId = viewAsId;
}

// Then use targetUserId instead of user.id for:
// - Loading fb_access_token from profiles
// - Verifying account ownership in fb_ad_accounts
```

### Step 3: Modify `app/api/settings/route.ts`

Add role to GET response:

```typescript
const [profileRes, accountsRes] = await Promise.all([
  service.from('profiles').select('fb_access_token, role').eq('id', user.id).single(),
  // ... existing accounts query
]);

return Response.json({
  fb_access_token: ...,
  role: (profileRes.data as any)?.role ?? 'staff',
  accounts: accountsRes.data ?? [],
});
```

## Todo List
- [ ] Create `app/api/leader/staff/route.ts` (GET)
- [ ] Modify `app/api/campaigns/route.ts` — add viewAs param
- [ ] Modify `app/api/settings/route.ts` — include role in response
- [ ] Test: leader can viewAs own staff member
- [ ] Test: leader cannot viewAs unassigned user
- [ ] Test: admin can viewAs any user
- [ ] Test: staff gets 403 when using viewAs
- [ ] Test: token never appears in response body

## Success Criteria
- Leader sees only their assigned staff in `/api/leader/staff`
- `viewAs` param works for leader (own team) and admin (any user)
- Staff user with viewAs param gets 403
- Campaign data returns correctly using staff's token
- `GET /api/settings` includes `role` field
- fb_access_token of staff never exposed in any response to leader/admin

## Security Considerations
- **Token isolation:** Staff's fb_access_token loaded server-side, used in fetchCampaigns(), never serialized to response
- **Relationship enforcement:** Leader must have team_members row to viewAs a staff member
- **Role loaded from DB:** Never trust client-sent role values
- **Account ownership:** viewAs still verifies the accountId belongs to the target staff user in fb_ad_accounts
