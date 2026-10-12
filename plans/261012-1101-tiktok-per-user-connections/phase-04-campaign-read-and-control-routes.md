# Phase 04 — Campaign read (viewAs) + control routes (own accounts)

## Context Links
- `app/api/tiktok/campaigns/route.ts`, `app/api/tiktok/campaigns/[campaignId]/route.ts`, `app/api/tiktok/adgroups/[adgroupId]/route.ts`
- FB reference: `app/api/campaigns/route.ts` (viewAs + `canViewAs`), `app/api/campaigns/[campaignId]/route.ts` (always caller's own token)
- Phase 2: `resolveOwnAdvertiserToken`, `getValidAccessToken(userId)`

## Overview
- Priority: P1. Status: implemented, pending deploy test. Effort: 1.5h. Blocked by Phase 2.
- Read route gains `?viewAs=` (FB parity). Control routes drop the admin|leader role gate and instead require the advertiser to be the requester's own selected row, acted on with the requester's own token.

## Key Insights
- FB control never borrows a staff token: leader acting on staff campaigns works only if the leader's own FB token has access. Mirror exactly: TikTok control = requester's token on requester's own advertiser rows. Leader/admin who also connected the same advertiser can control it from "My accounts".
- `verifyCampaignOwnership` / `verifyAdGroupOwnership` (campaign belongs to advertiser) stay — they guard against id-swapping inside an advertiser the user does own.

## Requirements — API contract (Phase 5 builds against this)
- `GET /api/tiktok/campaigns[?viewAs=<uid>][&level=adgroup]`
  - target = `viewAs ?? user.id`; if `viewAs && viewAs !== user.id` -> `canViewAs(user.id, viewAs)` (admin any, leader own team, else 403).
  - accounts = `tiktok_ad_accounts` where `user_id = target AND is_selected`; token = `getValidAccessToken(target)` (fetched once, reused for all advertisers — fan-out contract kept).
  - Response shape unchanged: `{campaigns}` | `{adgroups}`.
- `PATCH /api/tiktok/campaigns/:id` and `/adgroups/:id`: body unchanged `{action, advertiser_id, amount?}`; any role; `resolveOwnAdvertiserToken(user.id, advertiser_id)` -> 403 if not own selected row.

## Architecture — data flow
```
GET  ─ uid, viewAs ─> canViewAs? ─> rows(user_id=target,is_selected) ─> token(target) ─> batched fetch(3) ─> JSON
PATCH ─ uid, advertiser_id ─> resolveOwnAdvertiserToken(uid, adv) ─> verify*Ownership(token) ─> update ─> {success}
```

## Related Code Files
- Modify: the 3 route files above
- Create / Delete: none

## Implementation Steps
1. `campaigns/route.ts`: read `viewAs`, call `canViewAs` (import from `@/lib/auth-guards`), query `tiktok_ad_accounts` with `.eq('user_id', target)`, `getValidAccessToken(target)`. Empty-accounts error copy: own -> "No TikTok advertiser accounts selected. Connect in Settings."; viewAs -> "This user has no selected TikTok advertiser accounts."
2. `campaigns/[campaignId]/route.ts`: remove `requireRole` + inline advertiser lookup + token block; replace with `const token = await resolveOwnAdvertiserToken(user.id, body.advertiser_id); if (token instanceof Response) return token;`. Update header comment (per-user; mirrors FB own-token rule).
3. `adgroups/[adgroupId]/route.ts`: same as step 2.
4. `npx tsc --noEmit` on touched files.

## Todo List
- [x] campaigns GET: viewAs + canViewAs + per-target token/rows
- [x] campaign PATCH: own-advertiser guard, no role gate
- [x] adgroup PATCH: own-advertiser guard, no role gate

## Success Criteria
- Staff PATCH on own selected advertiser -> 200; on an advertiser only another user connected -> 403.
- Leader `GET ?viewAs=<own staff>` -> 200; `?viewAs=<staff of another leader>` -> 403; staff `?viewAs=<anyone else>` -> 403.

## Risk Assessment
| Risk | L x I | Mitigation |
|------|-------|-----------|
| viewAs used to borrow a staff token for writes | L x H | PATCH ignores viewAs entirely; token always `user.id` |
| Leader expects to control staff campaigns | M x L | Documented FB parity; UI hides controls in viewAs (Phase 5) |

## Security Considerations
- Target token used server-side for READ only, after `canViewAs`; never returned.
- Ownership determined from DB row `user_id = auth uid`, never from request body.

## Rollback
Revert commit.

## Next Steps
Phase 5 consumes the `viewAs` contract.
