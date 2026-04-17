# Phase 3 — Settings Page Redesign

## Context Links
- [Current settings page](../../app/settings/page.tsx)
- [Phase 2 — API Routes](./phase-02-api-routes.md)

## Overview
- **Priority:** P1
- **Status:** Pending
- **Depends on:** Phase 2
- **Description:** Redesign settings page to manage multiple FB accounts — list, add, remove, reveal token

## Key Insights
- Current page is a single form bound to profiles table — completely replaced
- Page stays `'use client'` — all interactions are fetch-based
- Token reveal requires a password prompt (modal or inline) before POST to /api/settings/reveal
- Accounts displayed with masked token (never fetched) and masked account ID suffix

## Requirements

### Functional
- On load: GET /api/settings → display list of accounts
- Each account row shows: label, masked account ID (e.g., `act_***789`), "Reveal Token" button, "Remove" button
- "Reveal Token" → prompt for admin password → POST /api/settings/reveal → show token in row (temporary, client-side only)
- "Remove" → confirm dialog → DELETE /api/settings/[accountId] → remove from list
- "Add Account" form at bottom: label, fb_ad_account_id, fb_access_token → POST /api/settings → append to list
- Sign out button retained

### Non-functional
- File must stay under 200 lines — extract account list item into inline component or keep it tight
- Existing nav structure (header with "Dashboard" link) preserved

## Architecture

```
SettingsPage (client component)
├── State: accounts[], addForm{}, revealedTokens{}, loading flags
├── Header (nav — unchanged structure)
├── Account List
│   └── AccountRow × N
│       ├── Label + masked account ID
│       ├── Reveal Token button → password prompt → shows token
│       └── Remove button → confirm → deletes
├── Add Account Form
│   ├── Label input
│   ├── Ad Account ID input
│   ├── Access Token input (password field)
│   └── Submit button
└── Sign Out button
```

## Related Code Files

### Modify
- `app/settings/page.tsx` — full rewrite

### Create
- None (keep it in one file, under 200 lines)

### Delete
- None

## Implementation Steps

### 1. Define local state

```typescript
const [accounts, setAccounts] = useState<FbAccount[]>([]);
const [loading, setLoading] = useState(true);
const [addForm, setAddForm] = useState({ label: '', fb_ad_account_id: '', fb_access_token: '' });
const [adding, setAdding] = useState(false);
const [error, setError] = useState('');
const [successMsg, setSuccessMsg] = useState('');
const [revealedTokens, setRevealedTokens] = useState<Record<string, string>>({});
```

### 2. Load accounts on mount

```
useEffect → fetch GET /api/settings → setAccounts(data.accounts)
```

### 3. Add account handler

```
1. Validate all three fields non-empty
2. POST /api/settings with { label, fb_ad_account_id, fb_access_token }
3. On success: append returned account to accounts[], clear form, show success
4. On 409: show "Account already exists" error
5. On other error: show error message
```

### 4. Remove account handler

```
1. window.confirm("Remove account {label}?")
2. DELETE /api/settings/[accountId]
3. On success: filter account out of accounts[]
4. On error: show error
```

### 5. Reveal token handler

```
1. const password = window.prompt("Enter admin password to reveal token")
2. If cancelled, return
3. POST /api/settings/reveal with { accountId, password }
4. On success: setRevealedTokens(prev => ({ ...prev, [accountId]: data.token }))
5. On 403: alert("Invalid password")
6. On error: show error
```

### 6. Render account list

Each account row:
```
<div> 
  <span>{account.label}</span>
  <span className="font-mono text-xs">{maskAccountId(account.fb_ad_account_id)}</span>
  {revealedTokens[account.id] 
    ? <code className="text-xs">{revealedTokens[account.id]}</code>
    : <button onClick={() => handleReveal(account.id)}>Reveal Token</button>
  }
  <button onClick={() => handleRemove(account.id, account.label)}>Remove</button>
</div>
```

Helper: `maskAccountId("act_123456789")` → `"act_***789"` (show last 3 digits)

### 7. Render add account form

Same card style as current page. Three inputs + submit button. Help text about Graph API Explorer retained.

## Todo List

- [ ] Rewrite settings/page.tsx with multi-account UI
- [ ] Implement account list with masked IDs
- [ ] Implement add account form with validation
- [ ] Implement remove account with confirmation
- [ ] Implement reveal token with password prompt
- [ ] Verify page compiles and renders correctly
- [ ] Verify file stays under 200 lines

## Success Criteria
- Page loads and shows all accounts (no tokens visible)
- Add form creates account, appears in list
- Remove button deletes account after confirmation
- Reveal shows token after correct admin password
- Wrong password shows alert, does not reveal
- Error states displayed for all API failures

## Risk Assessment
| Risk | Mitigation |
|------|------------|
| Page exceeds 200 lines | Use tight JSX, window.prompt/confirm instead of custom modals |
| Revealed token persists after navigation | Tokens in client state only — cleared on unmount automatically |
| User removes account currently selected on dashboard | Dashboard handles missing account gracefully (Phase 4) |

## Security Considerations
- Tokens never fetched by GET — only via reveal endpoint with admin password
- window.prompt is plain text (not masked) — acceptable for admin password since it's a power-user feature
- Revealed tokens are in-memory only, not persisted to localStorage or cookies

## Next Steps
- Can be developed in parallel with Phase 4
- Test with Phase 2 API routes
