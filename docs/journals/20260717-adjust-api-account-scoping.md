# Restore Adjust Revenue API Fetch: Account Scoping Fix

**Date**: 2026-07-17 14:48
**Severity**: High
**Component**: Adjust API Integration / Campaign Hub Revenue Fetch
**Status**: Resolved (pending Vercel env setup and browser verification)
**Commit**: 45560b5 (fix(adjust): restore Fetch Adjust Revenue with account ID and token auto-discovery)

## What Happened

Resurrected the dormant "Fetch Adjust Revenue via API" feature by diagnosing and fixing a multi-day blocking issue. Users have a "Fetch Data" button in campaign-hub.tsx (previously unreachable because `hasAdjustToken` was always false), intended as the primary UX for pulling revenue data. CSV upload was the fallback. The issue: Adjust's Report Service API was rejecting the user's valid app token with "Invalid app tokens. No apps matching the given app filters combination," leaving the button disabled months after initial implementation.

Root cause found (after wrong hypotheses): the user's Adjust account has multiple organizations/accounts, and their API token defaults to a different account than the one holding their tracked apps. Fix: implement an undocumented `adjust_account_id__in` query parameter pinning requests to the correct account (ID 36177, "Tevo"). Secondary improvement: replaced brittle manual env var (comma-separated list of ~20+ app tokens) with auto-discovery via Adjust's `filters_data` endpoint.

## The Brutal Truth

This debugging arc was frustrating and costly. Started with a simple "test the token" request, spiraled through wrong hypotheses (wrong user account? wrong role? missing partner/link permissions per Adjust's permission model diagram?), tried fixes that didn't address the actual problem (token regeneration, permission audits), and only got to the real root cause after the user's own Adjust support conversation surfaced the account_id parameter. Adjust's error message was actively misleading — it read like a token/permission rejection but was actually an account-scoping problem. This cost multiple sessions of debugging that could have been avoided with either (1) Adjust's own docs clearly stating the account_id parameter requirement, or (2) earlier escalation to their support channel.

Still outstanding: full browser-level manual testing hasn't happened (auth-gated dashboard + no browser automation tooling this session), and production env vars aren't deployed yet (requires user's Vercel access). We've validated the implementation via API testing and build checks, but the actual user click path remains unverified.

## Technical Details

**Adjust API behavior & diagnosis:**

The Adjust Report Service `apps` endpoint rejects requests with valid auth but app filters not matching the user's primary account. The endpoint itself is account-aware but the account selection is implicit (defaults to first account in user's list). Calling `filters_data` with the same credentials returns empty `apps`, `partners`, `networks` arrays, masking the real problem (you get the data for the wrong account, not an auth error).

**The fix:**
- `lib/adjust/api-client.ts`: Added `adjust_account_id__in` parameter to all `fetchAdjustRevenueToday()` calls. Replaces hardcoded reference to user's primary Adjust ID (36177) in headers/query.
- New `fetchAdjustAppTokens()` function: Auto-discovers app tokens by querying `filters_data?adjust_account_id__in=36177`, then fetches each app's revenue data. Eliminates the manual `ADJUST_APP_TOKEN=token1,token2,...` env var (operationally fragile — new apps silently excluded until env updated).
- `app/api/adjust/revenue/route.ts`: Updated to require `ADJUST_ACCOUNT_ID`, optional `ADJUST_APP_TOKEN` (for manual override if auto-discovery fails).
- `app/dashboard/page.tsx`: `hasAdjustToken` check updated to verify both `ADJUST_API_TOKEN` and `ADJUST_ACCOUNT_ID` exist.
- `.env.local.example`: Documented new env vars for future developers.

**Verification (no browser automation available):**
Standalone Node script faithfully reproduced the exact `fetchAdjustAppTokens` + `fetchAdjustRevenueToday` logic against the real Adjust API:
```
✓ Auto-discovered 15 app tokens via filters_data
✓ Fetched 794 revenue rows for today
✓ 548 rows attributed to Facebook campaigns
✓ Account ID scoping parameter accepted, non-matching account rejected (as expected)
```

`next build` + `eslint` both passed clean. Code-reviewer agent: 0 blocking issues, one stale JSDoc comment fixed.

## What We Tried

1. **Token regeneration** (Session 1): Assumed token was stale/revoked. User regenerated in Adjust UI. Same error persisted. ❌

2. **Permission audit** (Session 2): Checked Adjust's official permission model diagram, verified Custom role had access to Reports/Apps endpoints. Tried different permission combos. Error unchanged. ❌

3. **Partner/Link permissions** (Session 2-3): Consulted Adjust docs on partner/link model. Attempted to link/unlink Adjust account in dashboard. Didn't address the error. ❌

4. **Live API testing with curl** (Session 3): Tested request/response directly against Adjust API, confirmed token valid but apps endpoint returning empty or error based on account context. Pinpointed the account-scoping issue. ✓

5. **User's own Adjust support conversation** (Session 3): User opened ticket with Adjust support. They mentioned the `adjust_account_id__in` parameter for filtering apps by account. This was the breakthrough. ✓

## Root Cause Analysis

The user's Adjust login has administrative access to multiple Adjust organizations/accounts. Their default account (returned by most API calls without explicit account scoping) is NOT the account holding their mobile apps. The Report Service API is account-aware — it returns apps only for the account you query — but the default behavior silently uses the wrong account. Adjust's API docs didn't surface the `adjust_account_id__in` parameter prominently (or at all in the user's reading), and the error message ("Invalid app tokens") misled us into thinking it was a token/permission issue rather than an account-scoping issue.

The `filters_data` endpoint was the diagnostic tool that could have exposed this earlier: we noticed it returned empty apps/partners/networks arrays, but didn't immediately recognize that as a sign of wrong-account queries. Should have.

## Lessons Learned

1. **Misleading API errors are your enemy**: "Invalid app tokens" should not have meant "wrong token" — it meant "apps you specified don't exist in your queried account." Adjust's error message (and docs) needed clarification. For future integrations, always test against the actual API + docs, not just error messages.

2. **Multi-tenancy assumptions are risky**: If a service supports multiple accounts/organizations, assume users will have access to multiple. Default behavior (implicit account selection) will eventually break. Always require explicit account scoping in multi-tenant integrations.

3. **Support tickets beat debugging loops**: The user's Adjust support conversation surfaced the `adjust_account_id__in` parameter in one message. We spent 2+ sessions debugging before escalating. Escalate to support earlier when API docs are ambiguous or behavior is unexplained.

4. **Manual env var maintenance is technical debt**: The old approach (comma-separated `ADJUST_APP_TOKEN` env var) was operationally fragile. Auto-discovery via `filters_data` is better: it's self-healing (new apps auto-included), auditable (can check which apps we're tracking vs. which exist in Adjust), and doesn't require env redeploys when the app roster changes.

5. **Filters endpoints are diagnostic gold**: The `filters_data` endpoint should have been our first tool for debugging. It tells you what the API can actually see. If it returns empty, you're querying the wrong account/scope, not missing permissions.

## Next Steps

1. **Vercel production env vars** (BLOCKING): User must add `ADJUST_API_TOKEN` and `ADJUST_ACCOUNT_ID` to Vercel production environment variables. Until then, the live dashboard will fall back to CSV upload (feature unavailable to production users).
   - **Owner**: User (requires Vercel dashboard access)
   - **Blocker**: Yes (for production feature availability)

2. **Browser E2E verification** (BEFORE PRODUCTION): Verify the "Fetch Data" button actually works end-to-end:
   - Log into /dashboard
   - Click "Fetch Data" button in campaign-hub
   - Confirm revenue data loads for all apps without CSV upload needed
   - Verify UI state transitions (loading, success, error states)
   - **Owner**: QA/User (manual testing)
   - **Blocker**: No (feature is functionally complete, just needs integration verification)

3. **Future: Monitor for new apps in Adjust**: The auto-discovery will pick them up automatically now, but add a periodic audit (quarterly?) to verify the discovered count matches expectations.

4. **Document for future devs**: Add a comment in `lib/adjust/api-client.ts` explaining the multi-account scoping and why `adjust_account_id__in` is required. (Not done yet — TODO for next session if time permits.)

**Timeline**: Vercel env setup within 24h (user's action item). Browser testing same day. Ready for production after those two steps.
