# Phase 1: Token Storage & Settings

## Context Links
- [Settings API route](../../app/api/settings/route.ts)
- [Settings UI](../../app/settings/page.tsx)
- [Schema](../../supabase/schema.sql)
- [Plan overview](./plan.md)

## Overview
- **Priority:** P1 (blocks Phase 2 and 3)
- **Status:** Pending
- **Description:** Add `adjust_api_token` column to profiles table and expose save/remove in Settings UI using the same pattern as `fb_access_token`.

## Key Insights
- Existing pattern: `fb_access_token` stored in `profiles`, exposed as `has_token: boolean` via GET, saved via PATCH with service client (bypasses RLS)
- Settings UI uses password input + "Remove" button + status badge — replicate exactly
- Token must never be returned raw to browser

## Requirements

### Functional
- Add `adjust_api_token text` column to `profiles` table
- GET `/api/settings` returns `has_adjust_token: boolean` alongside existing `has_token`
- PATCH `/api/settings` accepts optional `adjust_api_token` field (string to set, null to remove)
- Settings UI shows "Adjust API Token" section below FB token section
- Status badge: green "Token configured" when set, input to paste new token, "Remove" button

### Non-Functional
- No breaking changes to existing settings behavior
- Token column nullable (default null for existing users)

## Architecture

```
Settings Page (client)
  ├─ GET /api/settings → { has_token, has_adjust_token, role, accounts }
  └─ PATCH /api/settings → { fb_access_token?, adjust_api_token?, accounts? }
       └─ service.from('profiles').update({ adjust_api_token: ... })
```

## Related Code Files

### Files to Modify
| File | Change |
|------|--------|
| `supabase/schema.sql` | Add `adjust_api_token text` column to profiles |
| `app/api/settings/route.ts` | GET: return `has_adjust_token`; PATCH: accept + save `adjust_api_token` |
| `app/settings/page.tsx` | Add Adjust token section (password input, status badge, remove) |

### Files NOT Modified
- All other files unchanged

## Implementation Steps

### 1. Schema Migration
Add to `supabase/schema.sql` (at end of profiles section):
```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS adjust_api_token text;
```
Run this in Supabase SQL editor. No default needed (null = no token).

### 2. Update Settings API Route (`app/api/settings/route.ts`)

**GET handler:**
- Line 18: Add `adjust_api_token` to the select query: `select('fb_access_token, adjust_api_token, role')`
- Line 25: Add to response: `has_adjust_token: !!profile?.adjust_api_token`

**PATCH handler:**
- Line 44: Extend body type: `adjust_api_token?: string | null`
- After the `fb_access_token` update block (line 60), add parallel block:
```typescript
if ('adjust_api_token' in body) {
  const { error } = await service
    .from('profiles')
    .update({ adjust_api_token: body.adjust_api_token ?? null })
    .eq('id', user.id);
  if (error) return errorResponse(error.message, 500);
}
```

**Optimization:** Combine both token updates into a single `.update()` call when both are present.

### 3. Update Settings UI (`app/settings/page.tsx`)

Add state variables (after existing token state, ~line 13):
```typescript
const [adjustToken, setAdjustToken] = useState('');
const [hasAdjustToken, setHasAdjustToken] = useState(false);
const [removeAdjustToken, setRemoveAdjustToken] = useState(false);
```

In the `useEffect` fetch handler (~line 27):
```typescript
setHasAdjustToken(!!data.has_adjust_token);
```

In `handleSave()` (~line 80):
```typescript
if (removeAdjustToken) payload.adjust_api_token = null;
else if (adjustToken.trim()) payload.adjust_api_token = adjustToken.trim();
```
After save success:
```typescript
if (adjustToken.trim()) { setHasAdjustToken(true); setAdjustToken(''); }
if (removeAdjustToken) setRemoveAdjustToken(false);
```

Add new UI section after the FB token card (after line 175), before accounts list:
- Same card structure as FB token section
- Title: "Adjust API Token"
- Help text: "Generate from Adjust Dashboard → Settings → API Tokens"
- Green badge when configured, password input, Remove button
- No "Fetch Ad Accounts" button (Adjust token doesn't have account discovery)

## Todo List

- [ ] Add `adjust_api_token` column to schema.sql
- [ ] Run migration in Supabase SQL editor
- [ ] Update GET handler to return `has_adjust_token`
- [ ] Update PATCH handler to accept `adjust_api_token`
- [ ] Add Adjust token state variables to Settings page
- [ ] Add Adjust token UI section
- [ ] Wire save/remove logic for Adjust token
- [ ] Test: save token → verify `has_adjust_token: true` on reload
- [ ] Test: remove token → verify `has_adjust_token: false`
- [ ] Test: existing FB token flow unaffected

## Success Criteria
- [ ] `has_adjust_token` returned by GET /api/settings
- [ ] Token can be saved and removed via Settings UI
- [ ] Token never returned raw in any API response
- [ ] Existing FB token + accounts functionality unchanged
- [ ] Settings page compiles without errors

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Migration fails on existing DB | Low | Med | `IF NOT EXISTS` clause; nullable column with no default |
| Breaking existing settings PATCH | Low | High | `adjust_api_token` is optional field; existing callers don't send it |

## Security Considerations
- Token stored as plaintext (same as `fb_access_token` — acceptable for this app's threat model)
- RLS on profiles table prevents cross-user reads
- Service client used for writes (bypasses RLS, server-only)
- Token never included in GET response payload

## Next Steps
- Phase 2 depends on this: needs token readable from profiles via service client
- Phase 3 depends on this: needs `has_adjust_token` prop for conditional UI
