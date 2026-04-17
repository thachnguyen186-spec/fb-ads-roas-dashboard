# Phase 02 — FB API Spending Limits Fetcher

## Context Links
- FB client: `lib/facebook/fb-client.ts` (uses `fbGet`)
- Existing pattern: `lib/facebook/ad-accounts.ts` (parallel-safe fetcher)
- FB Graph API v21 reference: `GET /{ad-account-id}?fields=spend_cap,amount_spent,currency,name`

## Overview
- **Priority:** P0 (blocker for 03, 04)
- **Status:** completed
- **Description:** New module `lib/facebook/spending-limits.ts` exporting `fetchSpendingLimits(token, accountIds[])` that returns one row per account in parallel.

## Key Insights
- FB API returns `spend_cap` and `amount_spent` as **strings** in the smallest currency unit. Must `parseFloat`.
- `spend_cap === '0'` (or absent) means "no cap set" → emit `null`, do not divide-by-zero.
- A single account can fail without failing the whole batch — wrap each call in try/catch and surface `error?: string` per row.
- `account_id` already starts with `act_`, do not double-prefix.

## Requirements
- Parallel fetch via `Promise.all` (mirrors `app/api/campaigns/route.ts:50`).
- Per-account error isolation (returning `{ account_id, error: string }` for failures).
- Stable shape consumed by both API route (phase 03) and cron (phase 04).

## Architecture
```
fetchSpendingLimits(token, ids)
  └─► Promise.all(
        ids.map(id =>
          fbGet(`/${id}`, { fields: 'spend_cap,amount_spent,currency,name' }, token)
            .then(toRow)
            .catch(e => ({ account_id: id, error: e.message }))
        )
      )
```

## Related Code Files
**Create:**
- `lib/facebook/spending-limits.ts`

**Modify:** none.

## Implementation Steps

1. Create `lib/facebook/spending-limits.ts`:
   ```typescript
   /**
    * Fetches spending-limit data for an array of FB ad account IDs in parallel.
    * Per-account failures are isolated — they appear as { account_id, error } rows
    * so a single bad account does not break the batch.
    */

   import { fbGet } from './fb-client';

   export interface SpendingLimitRow {
     account_id: string;        // "act_XXXXX"
     name: string;
     currency: string;
     /** Smallest unit (USD cents, VND units). null when account has no cap. */
     spend_cap: number | null;
     /** Smallest unit. */
     amount_spent: number;
     /** spend_cap - amount_spent; null when spend_cap is null. */
     remaining: number | null;
     /** Convenience for UI; null when spend_cap is null or 0. */
     percent_used: number | null;
   }

   export interface SpendingLimitError {
     account_id: string;
     error: string;
   }

   export type SpendingLimitResult = SpendingLimitRow | SpendingLimitError;

   interface RawAccount {
     id?: string;
     name?: string;
     currency?: string;
     spend_cap?: string;
     amount_spent?: string;
   }

   function toRow(accountId: string, raw: RawAccount): SpendingLimitRow {
     const cap = raw.spend_cap ? parseFloat(raw.spend_cap) : 0;
     const spent = raw.amount_spent ? parseFloat(raw.amount_spent) : 0;
     // FB returns '0' for "no cap" → treat as null (unlimited)
     const spend_cap = cap > 0 ? cap : null;
     const remaining = spend_cap !== null ? spend_cap - spent : null;
     const percent_used =
       spend_cap !== null && spend_cap > 0 ? (spent / spend_cap) * 100 : null;
     return {
       account_id: accountId,
       name: raw.name ?? accountId,
       currency: raw.currency ?? 'USD',
       spend_cap,
       amount_spent: spent,
       remaining,
       percent_used,
     };
   }

   export async function fetchSpendingLimits(
     token: string,
     accountIds: string[],
   ): Promise<SpendingLimitResult[]> {
     return Promise.all(
       accountIds.map(async (id) => {
         try {
           const raw = (await fbGet(
             `/${id}`,
             { fields: 'spend_cap,amount_spent,currency,name' },
             token,
           )) as RawAccount;
           return toRow(id, raw);
         } catch (err) {
           const msg = err instanceof Error ? err.message : 'Unknown FB error';
           return { account_id: id, error: msg };
         }
       }),
     );
   }

   export function isSpendingLimitError(
     r: SpendingLimitResult,
   ): r is SpendingLimitError {
     return 'error' in r;
   }
   ```

2. Manual smoke test plan (run in dev with a real token):
   - 1 account with `spend_cap` set → row populated, remaining > 0.
   - 1 account with no cap → `spend_cap === null`, `remaining === null`, `percent_used === null`.
   - Invalid account id → returns error row, others succeed.

## Todo List
- [x] Create `lib/facebook/spending-limits.ts`
- [x] `npx tsc --noEmit` passes
- [x] Smoke test against 1 real account (manual)

## Success Criteria
- Function compiles, types are exported.
- A failing FB call for one account does not throw; the rest succeed.
- `spend_cap === '0'` and `spend_cap` absent both yield `null`.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| FB schema drift (e.g. `spend_cap` becomes int) | Low | Med | `parseFloat` accepts both string and (via String coercion) number; type guard via `?` |
| N concurrent requests for large N (≥ 100) hit rate limit | Med | Med | Acceptable for now (typical user has < 30 accounts). If exceeded, add `p-limit` later (YAGNI now) |

## Security Considerations
- Token only flows through `fbGet`; never logged here.
- Per-account error message is forwarded — confirm error message does not leak token (FB error messages do not include the token).

## Next Steps
- Phase 03 imports `fetchSpendingLimits` for `GET /api/spending-limits`.
- Phase 04 imports `fetchSpendingLimits` + `isSpendingLimitError` for cron.
