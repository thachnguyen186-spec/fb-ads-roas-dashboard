# Phase 5 — Leader Dashboard

## Context
- [Phase 3](phase-03-leader-api-routes.md) must be complete (leader API + viewAs)
- [Dashboard page](../../app/dashboard/page.tsx) — server component to modify
- [Campaign hub](../../app/dashboard/components/campaign-hub.tsx) — client component to modify

## Overview
- **Priority:** P2
- **Status:** pending
- **Depends on:** Phase 3 (leader API routes)
- **Description:** Add staff-switcher dropdown to dashboard for leaders. When a leader selects a staff member, campaigns load using that staff member's token via the viewAs param.

## Key Insights
- Staff experience is unchanged — they see their own dashboard exactly as before
- Leader sees their own dashboard by default + a staff switcher dropdown in the header
- Admin also gets the staff switcher (can view any user)
- The switcher only changes the `viewAs` query param on API calls — no client-side token handling
- Dashboard page.tsx needs to pass role + staff list to CampaignHub

## Requirements

### Functional
- Dashboard server component fetches user's role and (if leader/admin) their staff list
- CampaignHub receives `role` and `staffList` props
- If role=leader/admin: render staff-switcher dropdown in header
- Dropdown options: "My Campaigns" (default) + each staff member (email)
- Selecting a staff member: re-fetches campaigns with `viewAs=staffId` param
- Selected staff member's ad accounts loaded via separate fetch
- Staff users see no UI change

### Non-Functional
- Staff switcher resets campaign state (like account switcher already does)
- Clear visual indicator of whose data is being viewed

## Architecture

### Data Flow
```
DashboardPage (server):
  1. Get user + role from profiles
  2. If leader: fetch staff list from /api/leader/staff (server-side)
  3. If admin: fetch all staff (or use service client directly)
  4. Pass {role, staffList, hasToken, selectedAccounts} to CampaignHub

CampaignHub (client):
  1. New state: viewAsUserId (null = own data)
  2. When staff selected: fetch their accounts, set activeAccountId
  3. Campaign fetch URL becomes: /api/campaigns?accountId=X&viewAs=Y
  4. When "My Campaigns" selected: reset to own accounts/data
```

### Props Change
```typescript
interface Props {
  hasToken: boolean;
  selectedAccounts: FbAdAccount[];
  role: UserRole;                    // NEW
  staffList: StaffMember[];          // NEW
}

interface StaffMember {
  id: string;
  email: string;
}
```

## Related Code Files

### Modify
- `app/dashboard/page.tsx` — fetch role + staff list, pass as props
- `app/dashboard/components/campaign-hub.tsx` — add staff switcher, viewAs param

### Read (for reference)
- `app/api/leader/staff/route.ts` — staff list endpoint (from Phase 3)
- `lib/types.ts` — UserRole type (from Phase 1)

## Implementation Steps

### Step 1: Modify `app/dashboard/page.tsx`

Add role and staff list fetching:

```tsx
// After existing profile/accounts fetch:
const roleData = profileRes.data as { fb_access_token?: string; role?: string } | null;
const role = (roleData?.role ?? 'staff') as UserRole;

let staffList: { id: string; email: string }[] = [];
if (role === 'leader' || role === 'admin') {
  // Fetch staff list server-side using service client
  if (role === 'leader') {
    const { data: team } = await service
      .from('team_members').select('staff_id').eq('leader_id', user.id);
    const staffIds = team?.map(t => t.staff_id) ?? [];
    if (staffIds.length > 0) {
      const { data: { users } } = await service.auth.admin.listUsers();
      staffList = users
        .filter(u => staffIds.includes(u.id))
        .map(u => ({ id: u.id, email: u.email ?? '' }));
    }
  } else {
    // Admin: list all non-admin users
    const { data: { users } } = await service.auth.admin.listUsers();
    const { data: profiles } = await service.from('profiles').select('id, role');
    staffList = users
      .filter(u => profiles?.find(p => p.id === u.id)?.role !== 'admin')
      .map(u => ({ id: u.id, email: u.email ?? '' }));
  }
}

return (
  <CampaignHub
    hasToken={hasToken}
    selectedAccounts={selectedAccounts}
    role={role}
    staffList={staffList}
  />
);
```

### Step 2: Modify `app/dashboard/components/campaign-hub.tsx`

Add staff switcher state and UI:

```tsx
// New state
const [viewAsUserId, setViewAsUserId] = useState<string | null>(null);
const [viewAsAccounts, setViewAsAccounts] = useState<FbAdAccount[]>([]);

// When staff selected, fetch their accounts
async function handleStaffSwitch(userId: string | null) {
  setViewAsUserId(userId);
  handleStartOver();
  if (!userId) return; // Back to own campaigns

  // Fetch staff's selected accounts
  // Need new endpoint or viewAs support in settings
  const res = await fetch(`/api/settings/accounts?viewAs=${userId}`);
  const data = await res.json();
  setViewAsAccounts(data.accounts ?? []);
  if (data.accounts?.length > 0) {
    setActiveAccountId(data.accounts[0].account_id);
  }
}
```

Modify campaign fetch URL:
```tsx
const viewAsParam = viewAsUserId ? `&viewAs=${viewAsUserId}` : '';
fetch(`/api/campaigns?accountId=${encodeURIComponent(activeAccountId)}${viewAsParam}`)
```

Add staff switcher in header (between title and account selector):
```tsx
{staffList.length > 0 && (
  <select
    value={viewAsUserId ?? ''}
    onChange={(e) => handleStaffSwitch(e.target.value || null)}
    className="text-xs border border-gray-300 rounded-lg px-2 py-1 ..."
  >
    <option value="">My Campaigns</option>
    {staffList.map((s) => (
      <option key={s.id} value={s.id}>{s.email}</option>
    ))}
  </select>
)}
```

### Step 3: Add viewAs support to accounts endpoint

Modify `app/api/settings/accounts/route.ts` to support `viewAs` param (same pattern as campaigns route — leader/admin gated).

## Todo List
- [ ] Update `app/dashboard/page.tsx` — fetch role + staff list
- [ ] Update CampaignHub props interface
- [ ] Add staff switcher dropdown to CampaignHub header
- [ ] Add viewAsUserId state and handler
- [ ] Modify campaign fetch to include viewAs param
- [ ] Add viewAs support to accounts route for loading staff's accounts
- [ ] Add visual indicator showing whose data is displayed
- [ ] Test: staff user sees no changes
- [ ] Test: leader sees staff switcher with assigned members only
- [ ] Test: switching staff loads their accounts and campaigns
- [ ] Test: "My Campaigns" resets to own data

## Success Criteria
- Staff users: zero visual/functional change
- Leaders: see staff dropdown with their assigned team members
- Selecting a staff member loads that user's accounts and campaigns
- "My Campaigns" option returns to leader's own data
- Admin: sees all non-admin users in the switcher
- No fb_access_token exposed to client at any point

## Security Considerations
- **Staff list from server:** Passed as props from server component, not fetched client-side (prevents enumeration)
- **viewAs validated server-side:** Every API call with viewAs re-checks role + relationship
- **Token isolation:** Staff's token used only in server-side fetchCampaigns(), never serialized
- **Account ownership:** viewAs also validates accountId belongs to target user

## Next Steps
- After all phases complete: update dashboard header to show Admin link for admin users
- Consider adding /admin link to navigation based on role
