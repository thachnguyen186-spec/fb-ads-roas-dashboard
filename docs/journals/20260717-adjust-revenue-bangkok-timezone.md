# Adjust Revenue: Today's Date Boundary Was in UTC, Not Bangkok Time

**Date**: 2026-07-17 10:45
**Severity**: High
**Component**: `lib/adjust/api-client.ts` / Adjust Revenue reporting
**Status**: Resolved

## What Happened

Hours after fixing the Adjust API account-scoping issue, the user reported that "today's" revenue numbers didn't match what they expected. A quick A/B test using curl against the live Adjust Report Service API revealed the discrepancy: the same query returned ~1,832 in revenue without the timezone offset parameter, but ~4,137 with `utc_offset=+07:00` — a 2.25x difference. Row count jumped from 876 to 1,080. The fix was deployed the same day (commit cfa6874).

## The Brutal Truth

This is infuriating because it's a completely avoidable mistake that has been silently wrong the entire time this tool has existed. The app serves a single Vietnam-based team (Bangkok, UTC+7), yet the code was computing "today" using the server's UTC clock and never telling the Adjust API to use a Bangkok-local day boundary. So every morning from midnight UTC to 7am UTC, ~7 hours of the team's business-day revenue was simply disappearing from the "today" total. The user — a real person reading real revenue numbers — caught this by noticing reality didn't match. We didn't have a test suite to catch it. We just let it quietly bleed data for however long this code has existed.

## Technical Details

**Root Issue**: `fetchAdjustRevenueToday()` in `lib/adjust/api-client.ts` computed the date string using UTC:
```
const today = new Date().toISOString().slice(0, 10);  // 2026-07-17 (UTC)
```

For a team in Bangkok (UTC+7), when it's 6am Bangkok time on July 17, the UTC clock reads midnight on July 17. So the Adjust API was told to fetch "today = July 17" starting from UTC midnight, which for Bangkok is 7am on July 17. The first 7 hours of Bangkok's business day (midnight to 7am Bangkok time = July 16 20:00 UTC to July 17 03:00 UTC) fell into the previous UTC calendar day and was silently excluded.

Additionally, the API call never sent the `utc_offset` query parameter, so Adjust defaulted to UTC=0 (UTC midnight bucket boundaries).

**Bonus Finding**: The code was also fetching a `network_cost` metric from Adjust's API (`ad_spend_mode: 'network'`) but this field was dead data — it was never used. `lib/adjust/merge.ts` explicitly sources all ad spend from Facebook's Insights API (`campaign.spend`), and the user confirmed this is intentional because Adjust's spend data lags behind Facebook's. So `network_cost` was being fetched and discarded the entire time.

**Verification — Live A/B Testing**:
- Query without `utc_offset`: revenue = ~1,832, rows = 876
- Same query + `utc_offset=+07:00`: revenue = ~4,137, rows = 1,080
- Standalone Node.js script using the fixed logic: ~4,170 revenue (consistent)

## What We Tried

1. **Initial diagnosis via /fix skill** (scout → diagnose → fix → verify workflow, Quick mode selected):
   - Reviewed `fetchAdjustRevenueToday()` and spotted the UTC-only date computation
   - Checked Adjust API docs to confirm `utc_offset` parameter behavior
   - A/B tested the theory via curl against live Adjust API to quantify the impact

2. **Tooling detour**: Bash tool broke mid-session with persistent shell parsing errors (`unexpected EOF while looking for matching '\"'`) on simple commands. Switched to PowerShell, which worked fine for all remaining work (Node script execution, build/lint, git operations).

3. **Implementation**:
   - Added `ADJUST_UTC_OFFSET = '+07:00'` module constant (sent on every Report API call)
   - Changed date computation from UTC to Bangkok-local: `new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())`
   - Removed `network_cost` from metrics list and `AdjustApiRow` interface (dead data)
   - Removed now-irrelevant `ad_spend_mode: 'network'` parameter

4. **Verification**:
   - Node.js script against live Adjust API: ✓ ~4,170 revenue (expected)
   - `next build` (full typecheck): ✓ clean
   - `eslint`: ✓ clean (pre-existing unrelated warnings elsewhere only)
   - code-reviewer subagent: ✓ 0 blocking issues
   - Cross-checked: Adjust API docs + localization; Thailand has used fixed UTC+7 since 1920 (no DST), so hardcoded offset is a permanent invariant

## Root Cause Analysis

1. **Date boundary misalignment**: The dev environment or the server running the fetch is UTC-based, not Bangkok-based. Defaulting to `new Date().toISOString()` is a trap for international apps.

2. **API parameter oversight**: Even if the date string were correct, the Adjust API requires an explicit `utc_offset` to bucket revenue by local day boundaries. This was not sent.

3. **Dead data accumulation**: `network_cost` was being requested and fetched but never used. The code had a clear contract with Facebook's spend data, so this was waste.

4. **No test coverage**: There's no automated test suite in this repo, so real-world usage (the user noticing the number was wrong) was the only validation. A simple integration test fetching one day of revenue and spot-checking against the Adjust dashboard would have caught this immediately.

## Lessons Learned

1. **Hardcode locale/timezone carefully in revenue-critical code**: When you hardcode `'+07:00'`, document why (team location) and verify it's permanent (Thailand: no DST, fixed offset since 1920). This is correct but looks alarming at first glance.

2. **Use local-time date formatting for local reporting**: `new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' })` is the right pattern. It's explicit, respects the team's timezone, and pairs visually with the offset parameter being sent to the API.

3. **Dead data is a red flag**: When a metric is fetched but not used, it will eventually cause confusion. Remove it. The fact that `network_cost` was dead actually helped diagnose the revenue issue — its bit-for-bit identity across all test variants was a clue that the fetch path was being ignored.

4. **User-reported data mismatches are your smoke test**: This team noticed "the number is wrong" before we had automation. That's the most reliable signal in an under-tested codebase. Treat it as critical.

5. **Tool resilience**: Bash broke mid-session, but PowerShell stepped in seamlessly. Both are available; use either.

## Next Steps

- **Immediate**: None. Deployed same day (commit cfa6874, pushed to origin/master).
- **Follow-up**: Consider adding a simple integration test for revenue fetching (mock or live daily run against Adjust API) to catch future timezone/parameter drifts. Current repo has no test suite, so this could be a separate task.
- **Documentation**: Ensure timezone offset is documented in code comments for future maintainers. It's already documented in this journal, but code-level comments help.
- **Awareness**: If this tool ever expands to multi-timezone teams, the hardcoded offset becomes a blocker — architecture would need to change. Flag this for the product roadmap.

**Commit**: cfa6874 (`fix(adjust): use Bangkok-local day boundary for today's revenue`)
**Files modified**: `lib/adjust/api-client.ts` only
