# Phase 06 — Accounting Export + Account Owners: visibility-scoped, owner tokens

## Context Links
- `app/api/accounting-export/route.ts` (exactly 200 lines — must shrink), `app/api/account-owners/route.ts`
- `lib/auth-guards.ts` `getVisibleUserIds`; `lib/accounting/build-rows.ts` (`buildTiktokRows`, unchanged)

## Overview
- Priority: P1. Status: implemented, pending deploy test. Effort: 2h. Blocked by Phase 2.
- TikTok leg + account-owners switch from "every advertiser" to "advertisers connected by visible users"; each advertiser fetched with one of its owners' own tokens; deduped by advertiser_id.

## Key Insights
- Same advertiser connected by 2 visible users must be exported ONCE (else spend double-counted). FB leg does not dedupe today — out of scope, flagged as concern.
- Resolve tokens once per distinct owner (not per advertiser) — keeps the old "one token per request" fan-out spirit.
- Export keeps current semantics: ALL connected advertisers (not only `is_selected`).

## Requirements
- `tiktokLeg(visibleIds, dateParam, ownerMap)`:
  1. rows = `tiktok_ad_accounts` `.in('user_id', visibleIds)` -> `advertiser_id, user_id, name, currency`.
  2. group by advertiser_id -> `{ name, currency, ownerIds[] }`.
  3. owners = distinct user_ids; `getValidAccessToken(uid)` for each (bounded by `runBatched`); failures -> warning `tiktok: user <email|uid>: <describeAuthError msg>`.
  4. per advertiser pick first owner with a resolved token; none -> warning `tiktok <advertiser_id>: no valid owner token`.
  5. existing per-advertiser fetch + `buildTiktokRows` unchanged.
- Account owners GET: TikTok list from `tiktok_ad_accounts` `.in('user_id', visibleIds)`, deduped by advertiser_id (same as FB map dedupe).
- Account owners PATCH (tiktok): existence check `.eq('advertiser_id', id).in('user_id', visibleIds)` -> 403 "Forbidden — account not in your visible set" (FB parity).
- Role gates unchanged (admin|leader).

## Architecture — data flow
```
GET /api/accounting-export ─ uid ─> getVisibleUserIds ─┬─ fbLeg (unchanged)
                                                       └─ tiktokLeg(visibleIds)
   tiktok_ad_accounts in visibleIds ─> group by advertiser ─> tokens per owner ─> pick owner token
   ─> runBatched(fetchCampaigns + fetchSpend + fetchCampaignTargets) ─> buildTiktokRows ─> rows/warnings
```

## Related Code Files
- Create: `lib/accounting/run-batched.ts` (move `runBatched` + `CONCURRENCY`, `MAX_CONSECUTIVE_FAILS` from route), `lib/accounting/tiktok-export-leg.ts` (move + rewrite `tiktokLeg`; export `LegResult` type here or in run-batched)
- Modify: `app/api/accounting-export/route.ts` (import both, pass `visibleIds` to tiktokLeg, update header comment), `app/api/account-owners/route.ts`
- Delete: none

## Implementation Steps
1. Move `runBatched` (+ constants, `LegResult`) to `lib/accounting/run-batched.ts`; route imports it (fbLeg unchanged otherwise).
2. Create `tiktok-export-leg.ts` per Requirements. Owner-token resolution: `Promise.allSettled` in chunks of 3 via `chunk` from `@/lib/utils`. Use user id in warnings (no extra listUsers call — YAGNI).
3. Route: `wantTiktok ? tiktokLeg(visibleIds, dateParam, ownerMap)`; drop now-unused imports. Confirm < 200 lines.
4. Account owners GET/PATCH per Requirements; update header comment ("TikTok scoped by getVisibleUserIds").
5. `npx tsc --noEmit`.

## Todo List
- [x] run-batched.ts extracted
- [x] tiktok-export-leg.ts with owner-token resolution + dedupe
- [x] route wired, < 200 lines
- [x] account-owners GET scoped + deduped
- [x] account-owners PATCH tiktok scope check

## Success Criteria
- Leader export contains TikTok rows only for advertisers connected by self/team; admin export covers all connected users.
- Advertiser connected by 2 users appears once.
- One user's revoked token -> warning naming that user, other users' rows still exported.

## Risk Assessment
| Risk | L x I | Mitigation |
|------|-------|-----------|
| Double-counted spend for shared advertisers | M x H | Dedupe by advertiser_id before fan-out; test 14 |
| Leader loses visibility of TikTok accounts they saw before (org-wide) | H x L | Expected per decision 1; communicate in release note |
| Vercel 60s cap with more token lookups | L x M | Token lookups are DB reads (no TikTok call unless refresh_token) |

## Security Considerations
- Owner tokens used only server-side, only for advertisers the owner connected, only for visible users.
- PATCH scope check prevents leader labelling an advertiser outside their team.

## Rollback
Revert commit.

## Next Steps
Phase 7 tests 13-16.
