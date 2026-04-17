# Phase 4 — Dashboard Account Picker

## Context Links
- [Current dashboard page](../../app/dashboard/page.tsx)
- [Current campaign-hub](../../app/dashboard/components/campaign-hub.tsx)
- [Phase 2 — API Routes](./phase-02-api-routes.md)

## Overview
- **Priority:** P1
- **Status:** Pending
- **Depends on:** Phase 2
- **Description:** Replace boolean hasFbConfig with accounts array; add account dropdown before Analyze

## Key Insights
- Dashboard server component currently queries `profiles` for credentials — must switch to `fb_accounts`
- CampaignHub receives `hasFbConfig: boolean` — changes to `accounts: FbAccount[]`
- Account selection drives which credentials the campaigns API uses via `?accountId=X`
- If zero accounts → show "go to settings" callout (same UX as current no-config state)
- Dropdown appears between CSV upload and Analyze button

## Requirements

### Functional
- Server component loads accounts from fb_accounts (id, label, fb_ad_account_id, created_at — no tokens)
- Pass `accounts: FbAccount[]` to CampaignHub
- CampaignHub shows dropdown to select account (default: first account)
- Analyze button sends `?accountId={selectedAccountId}` to campaigns API
- No accounts → show "go to settings" callout (replaces hasFbConfig check)

### Non-functional
- campaign-hub.tsx must stay under 200 lines (currently 217 — needs trimming anyway)
- Dropdown only shown when accounts.length > 0

## Architecture

```
DashboardPage (server)
  ├── Auth check (unchanged)
  ├── Query fb_accounts for user (replaces profiles query)
  └── <CampaignHub accounts={accounts} />

CampaignHub (client)
  ├── selectedAccountId state (default: accounts[0]?.id)
  ├── Account dropdown (between CSV upload and Analyze)
  ├── handleAnalyze → fetch /api/campaigns?accountId={selectedAccountId}
  └── No accounts → callout with Settings link
```

## Related Code Files

### Modify
- `app/dashboard/page.tsx` — query fb_accounts instead of profiles, pass accounts[]
- `app/dashboard/components/campaign-hub.tsx` — add dropdown, pass accountId to API

### Create
- None

### Delete
- None

## Implementation Steps

### 1. Update `app/dashboard/page.tsx`

Replace profiles query:

```typescript
// OLD
const { data: profile } = await service
  .from('profiles')
  .select('fb_access_token, fb_ad_account_id')
  .eq('id', user.id)
  .single();
const hasFbConfig = !!(profile?.fb_access_token && profile?.fb_ad_account_id);
return <CampaignHub hasFbConfig={hasFbConfig} />;

// NEW
const { data: accounts } = await service
  .from('fb_accounts')
  .select('id, label, fb_ad_account_id, created_at')
  .eq('user_id', user.id)
  .order('created_at');
return <CampaignHub accounts={accounts ?? []} />;
```

Import `FbAccount` from `@/lib/types`.

### 2. Update CampaignHub props

```typescript
// OLD
interface Props { hasFbConfig: boolean; }

// NEW
import type { FbAccount } from '@/lib/types';
interface Props { accounts: FbAccount[]; }
```

### 3. Add selectedAccountId state

```typescript
const [selectedAccountId, setSelectedAccountId] = useState<string>(
  accounts[0]?.id ?? ''
);
const hasAccounts = accounts.length > 0;
```

### 4. Replace hasFbConfig callout

```typescript
// OLD: {!hasFbConfig && ( <callout> ... </callout> )}
// NEW: {!hasAccounts && ( <callout> ... </callout> )}
```

Same callout text and styling — just uses hasAccounts instead.

### 5. Add account dropdown

Insert between CSV upload section and Analyze button, inside the upload card:

```typescript
{hasAccounts && accounts.length > 1 && (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">FB Account</label>
    <select
      value={selectedAccountId}
      onChange={(e) => setSelectedAccountId(e.target.value)}
      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
    >
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.label} ({a.fb_ad_account_id})
        </option>
      ))}
    </select>
  </div>
)}
```

Note: dropdown only rendered when 2+ accounts. Single account auto-selected silently.

### 6. Update handleAnalyze fetch

```typescript
// OLD
fetch('/api/campaigns')

// NEW
fetch(`/api/campaigns?accountId=${selectedAccountId}`)
```

### 7. Disable Analyze if no account selected

```typescript
// AdjustCsvUpload disabled prop
<AdjustCsvUpload onReady={handleCsvReady} disabled={!hasAccounts} />
```

This replaces the old `disabled={!hasFbConfig}`.

## Todo List

- [ ] Update dashboard/page.tsx to query fb_accounts and pass accounts[]
- [ ] Update CampaignHub props from hasFbConfig to accounts
- [ ] Add selectedAccountId state with default to first account
- [ ] Add account dropdown (only when 2+ accounts)
- [ ] Update handleAnalyze to pass accountId query param
- [ ] Replace hasFbConfig checks with hasAccounts
- [ ] Verify both files compile without errors
- [ ] Verify campaign-hub.tsx stays under 200 lines

## Success Criteria
- Dashboard loads accounts from fb_accounts table
- Single account: no dropdown, auto-selected
- Multiple accounts: dropdown visible, user can switch
- Analyze sends correct accountId to campaigns API
- Zero accounts: callout shown, Analyze disabled

## Risk Assessment
| Risk | Mitigation |
|------|------------|
| campaign-hub.tsx already 217 lines, adding dropdown makes it worse | Dropdown is ~10 lines of JSX; offset by removing hasFbConfig logic. Net change is small. If needed, extract dropdown to separate component. |
| Selected account deleted while on dashboard | API returns 404 → error phase shows message → user can start over or go to settings |
| accounts prop empty array on first render | Default selectedAccountId to '' → Analyze button disabled when no accounts |

## Security Considerations
- Accounts array contains no tokens (server query selects only id, label, fb_ad_account_id, created_at)
- accountId param validated server-side in campaigns API (Phase 2) — user_id check prevents cross-user access

## Next Steps
- Deploy Phase 2 + 3 + 4 together (API routes, settings page, dashboard all reference new table)
- After deployment, old profiles.fb_access_token and profiles.fb_ad_account_id columns can be dropped in a future cleanup
