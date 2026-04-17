# Phase 03 — API Routes (GET list, PATCH threshold)

## Context Links
- Auth pattern: `app/api/campaigns/route.ts` (token + service client)
- Account-scoped route pattern: `app/api/settings/accounts/[accountId]/route.ts`
- Helpers: `lib/utils.ts` (`errorResponse`)

## Overview
- **Priority:** P0 (blocker for 05)
- **Status:** completed
- **Description:** Two routes:
  - `GET /api/spending-limits` → fetch FB live data merged with stored thresholds.
  - `PATCH /api/spending-limits/[accountId]` → update threshold; reset `alert_sent`.

## Key Insights
- Match the campaigns route's auth/error pattern verbatim — users already see those messages, less surprise.
- PATCH must reset `alert_sent=false` whenever threshold changes (otherwise raising the threshold above current spend would never re-alert when it later drops).
- Owner check on PATCH via `eq('user_id', user.id)` — RLS would also protect, but explicit `eq` lets us return 404 cleanly.

## Requirements
- `GET` returns: `{ accounts: [SpendingLimitRow + { alert_threshold, alert_sent }] }` for selected accounts.
- `PATCH` accepts JSON body `{ alert_threshold: number | null }`. `null` disables.
- Both routes require auth; both return 401 / 400 / 502 in line with existing routes.

## Architecture
```
GET /api/spending-limits
  ├── createClient() → user
  ├── createServiceClient()
  ├── parallel: profile.fb_access_token + selected fb_ad_accounts (incl alert_threshold, alert_sent)
  ├── fetchSpendingLimits(token, account_ids)
  └── merge by account_id → { accounts }

PATCH /api/spending-limits/[accountId]
  ├── createClient() → user
  ├── parse body { alert_threshold: number | null }
  ├── validate (number ≥ 0 OR null)
  └── service.update({ alert_threshold, alert_sent: false }).eq(account_id).eq(user_id)
```

## Related Code Files
**Create:**
- `app/api/spending-limits/route.ts`
- `app/api/spending-limits/[accountId]/route.ts`

**Modify:** none.

## Implementation Steps

### 1. Create `app/api/spending-limits/route.ts`
```typescript
/**
 * GET /api/spending-limits
 * Fetches spend_cap / amount_spent / remaining for ALL of the user's
 * selected ad accounts, merged with the stored alert_threshold.
 */

import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import {
  fetchSpendingLimits,
  isSpendingLimitError,
  type SpendingLimitResult,
} from '@/lib/facebook/spending-limits';

interface AccountRow {
  account_id: string;
  name: string;
  currency: string;
  alert_threshold: number | null;
  alert_sent: boolean;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const service = createServiceClient();
  const [profileRes, accountsRes] = await Promise.all([
    service.from('profiles').select('fb_access_token').eq('id', user.id).single(),
    service
      .from('fb_ad_accounts')
      .select('account_id, name, currency, alert_threshold, alert_sent')
      .eq('user_id', user.id)
      .eq('is_selected', true),
  ]);

  if (!profileRes.data) return errorResponse('Profile not found', 404);
  const { fb_access_token } = profileRes.data as { fb_access_token: string | null };
  if (!fb_access_token) return errorResponse('Facebook access token not configured.', 400);

  const stored = (accountsRes.data ?? []) as AccountRow[];
  if (stored.length === 0) return errorResponse('No ad accounts selected. Go to Settings.', 400);

  try {
    const live: SpendingLimitResult[] = await fetchSpendingLimits(
      fb_access_token,
      stored.map((a) => a.account_id),
    );
    const liveMap = new Map(live.map((r) => [r.account_id, r]));
    const accounts = stored.map((s) => {
      const l = liveMap.get(s.account_id);
      if (!l) {
        return { ...s, error: 'No FB response', spend_cap: null, amount_spent: 0, remaining: null, percent_used: null };
      }
      if (isSpendingLimitError(l)) {
        return { ...s, error: l.error, spend_cap: null, amount_spent: 0, remaining: null, percent_used: null };
      }
      // Prefer live name/currency (FB is source of truth) but fall back to DB
      return {
        ...s,
        name: l.name || s.name,
        currency: l.currency || s.currency,
        spend_cap: l.spend_cap,
        amount_spent: l.amount_spent,
        remaining: l.remaining,
        percent_used: l.percent_used,
      };
    });
    return Response.json({ accounts, fetched_at: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch spending limits';
    const isTokenErr = /token|session|oauth|expired/i.test(message);
    return errorResponse(
      isTokenErr
        ? `Facebook token error: ${message}. Go to Settings and refresh your access token.`
        : message,
      502,
    );
  }
}
```

### 2. Create `app/api/spending-limits/[accountId]/route.ts`
```typescript
/**
 * PATCH /api/spending-limits/:accountId
 * Updates the per-account alert threshold and resets the alert_sent dedup flag
 * (so the next crossing fires an alert again).
 *
 * Body: { alert_threshold: number | null }   // null disables alerting
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const { accountId } = await params;
  if (!accountId) return errorResponse('accountId required', 400);

  let body: { alert_threshold?: unknown };
  try {
    body = (await request.json()) as { alert_threshold?: unknown };
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const raw = body.alert_threshold;
  let alert_threshold: number | null;
  if (raw === null || raw === undefined || raw === '') {
    alert_threshold = null;
  } else if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    alert_threshold = raw;
  } else {
    return errorResponse('alert_threshold must be a non-negative number or null', 400);
  }

  const service = createServiceClient();
  const { error, count } = await service
    .from('fb_ad_accounts')
    .update({ alert_threshold, alert_sent: false }, { count: 'exact' })
    .eq('account_id', accountId)
    .eq('user_id', user.id);

  if (error) return errorResponse(error.message, 500);
  if (!count) return errorResponse('Account not found', 404);
  return Response.json({ success: true, alert_threshold });
}
```

## Todo List
- [x] Create `app/api/spending-limits/route.ts`
- [x] Create `app/api/spending-limits/[accountId]/route.ts`
- [x] `npx tsc --noEmit` passes
- [x] Smoke test: `curl localhost:3000/api/spending-limits` (auth cookie via browser)
- [x] Smoke test: `PATCH /api/spending-limits/act_XXX -d '{"alert_threshold": 5000}'`

## Success Criteria
- GET returns 200 with `accounts[]` containing live + stored fields.
- GET returns 400 with the campaigns-style "token error" message when token invalid.
- PATCH 200 + DB row updated; `alert_sent` reset to false.
- PATCH on someone else's `accountId` returns 404 (not 200).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Body parser receives string `"5000"` instead of number | Med | Low | Tight validation: `typeof raw === 'number'`; client must `Number(...)` before send |
| Stored DB row has stale `alert_sent=true` after threshold lowered below current remaining | Low | Med | PATCH always resets to false — regardless of new value |
| `count` field unsupported on certain Supabase clients | Low | Low | Fallback: `select` after update; not needed for current `@supabase/ssr` version |

## Security Considerations
- Auth required on both routes.
- Service client used after explicit `eq('user_id', user.id)` (defense in depth alongside RLS).
- Token never returned to client.

## Next Steps
- Phase 04 reuses `fetchSpendingLimits` directly (does not depend on this route).
- Phase 05 consumes both routes.
