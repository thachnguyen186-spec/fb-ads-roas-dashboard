# Code Review: Adjust API auto-discovery + account ID fix

Scope: uncommitted diff to `lib/adjust/api-client.ts`, `app/api/adjust/revenue/route.ts`, `app/dashboard/page.tsx`.
Plan: `plans/260717-1339-adjust-api-fetch-flow/plan.md`. `tsc --noEmit` passes clean. No stale call sites for
`fetchAdjustRevenueToday` (only caller is route.ts, already updated to 4-arg signature; no tests reference it).

## Verdict
No blocking issues. Change is minimal, additive, consistent with existing file conventions (truncated error
bodies, 30s AbortSignal timeout, JSDoc style). Safe to land as-is.

## Checked against spec

1. **`fetchAdjustAppTokens()`** — error handling matches existing pattern exactly (non-200 → truncate body to
   200 chars into thrown Error). URL/params correct (`required_filters=apps&adjust_account_id__in=X`). Return
   mapping (`data.apps.map(a => a.id)`) matches plan spec.
2. **Auto-discovery fallback** — empty `appTokens` → `fetchAdjustAppTokens()` → still-empty → throw
   `'No Adjust apps found for this account.'`. Logic is correct. `adjust_account_id__in` added to the same
   `URLSearchParams` object as the other report params — no key collision, no conflict with the `app_token[]`
   bracket-notation appends done afterward.
3. **`route.ts`** — `ADJUST_API_TOKEN` and `ADJUST_ACCOUNT_ID` both independently return 400 if missing.
   `ADJUST_APP_TOKEN` genuinely optional: parsed to `[]` when unset and passed through without validation/throw.
   No leftover dead code from the old "always required" branch — cleanly removed.
4. **`dashboard/page.tsx`** — `hasAdjustToken` now gates on `ADJUST_API_TOKEN && ADJUST_ACCOUNT_ID` only, no
   longer references `ADJUST_APP_TOKEN`. Matches spec.
5. **Security** — no new leak surface. `hasAdjustToken` is a boolean only (never exposes the token/account id
   values to the client). Both Adjust HTTP calls use the same truncate-to-200-chars error pattern; no secrets
   logged. Client-supplied `appFilter` query param is only used in an in-memory `===` comparison, never
   interpolated into an outbound URL — no injection surface (pre-existing, unchanged by this diff).
6. **YAGNI/KISS** — appropriately minimal. No new abstractions, no config layer, no premature caching of the
   discovered app list (correctly re-discovers per request, consistent with "today's data" semantics elsewhere
   in the file).

## Informational (non-blocking)

- `fetchAdjustRevenueToday` reassigns its own `appTokens` parameter (`appTokens = await
  fetchAdjustAppTokens(...)`) instead of binding a new local. Works correctly (no aliasing bug — this rebinds
  the local, doesn't mutate the caller's array), but a fresh `const discoveredTokens` would read slightly
  clearer. Style-only.
- `fetchAdjustAppTokens()`'s `data.apps` cast (`as { apps?: Array<{ id: string }> }`) is unchecked at runtime —
  if Adjust ever returns an app entry without `id`, `undefined` would get silently appended as a literal
  `app_token[]=undefined` query value. Matches the existing loose-typing style already used for the CSV
  (`AdjustApiRow`) in this same file, so not a new pattern; flagging only since it's externally-sourced data.
  Not worth adding validation for an internal tool per YAGNI unless it's actually seen in practice.
- Pre-existing (not touched by this diff): the JSDoc on `fetchAdjustRevenueToday`'s `token` param still says
  "from profiles.adjust_api_token" — stale now that the org-wide flow reads from `process.env` instead of the
  profiles table. Optional cleanup, unrelated to this change.

## Unresolved questions
None.
