# Phase 05 — TikTok dashboard: per-user data + staff picker

## Context Links
- `app/dashboard/tiktok/page.tsx`, `components/tiktok-campaign-hub.tsx` (188 lines), `tiktok-header.tsx`, `tiktok-results-panel.tsx`, `tiktok-adgroup-flat-view.tsx`, `tiktok-adgroup-row.tsx`
- FB pattern: `app/dashboard/page.tsx` (server-loaded `staffList`), `app/dashboard/components/campaign-hub.tsx` lines 36-38, 333, 555-571
- Contract: [phase-04](./phase-04-campaign-read-and-control-routes.md)

## Overview
- Priority: P1. Status: implemented, pending deploy test (hub at 201 lines, split still open). Effort: 2.5h. Blocked by Phase 2 (+ Phase 4 contract).
- Own accounts by default; leader/admin get a "My accounts / <user email>" select listing visible users who have connected TikTok. Selecting one re-fetches with `?viewAs=`; controls hidden while viewing someone else.

## Key Insights
- FB admin picker lists only admin's `team_members` rows; user decision says admin sees everyone -> TikTok uses `getVisibleUserIds` (intentional divergence, admin list = all users).
- Listing only users WITH a TikTok connection keeps admin's dropdown short and avoids empty views.
- Single-user view (no "all users" aggregate) = FB parity; aggregate across users is the Accounting Export's job (YAGNI).

## Requirements
- Server page passes: `hasTiktokConnection` (own), `selectedAdvertisers` (own selected), `userRole`, `staffList: TiktokStaffMember[]`, `hasAdjustToken`, `userEmail`.
- Picker visible when role is leader|admin and `staffList.length > 0`.
- Switching user: reset to idle phase, clear results/selection; `canFetch` uses viewed user's accounts.
- All reads (`/api/tiktok/campaigns`, `?level=adgroup` in results panel) append `viewAs` when set. Adjust revenue fetch unchanged (org-wide).
- `readOnly = !!viewingUserId`: no action bar, no per-row budget edit button, small notice "Viewing <email> — read-only. Controls work on accounts you connected yourself."
- Not-connected notice drops "(admin only)".

## Architecture — data flow
```
page.tsx (server) ─ user, role ─> getConnectionStatus(uid), own selected rows
                                └> loadTiktokStaffList(uid, role)  [lib/tiktok/viewable-users.ts]
                                    getVisibleUserIds -> minus self -> listConnectedUserIds
                                    -> tiktok_ad_accounts(selected) in ids + listUsers emails -> TiktokStaffMember[]
hub (client) ─ viewingUserId ─> GET /api/tiktok/campaigns?viewAs=… ─> results panel(readOnly, viewAs)
```

## Related Code Files
- Create: `lib/tiktok/viewable-users.ts` (`loadTiktokStaffList(userId, role): Promise<TiktokStaffMember[]>`; staff -> []; catches listUsers failure -> [] + console.error)
- Modify: `app/dashboard/tiktok/page.tsx`, `components/tiktok-campaign-hub.tsx`, `components/tiktok-header.tsx` (renders picker + "Viewing" chip), `components/tiktok-results-panel.tsx` (props `viewAs?: string`, `readOnly: boolean`), `components/tiktok-adgroup-flat-view.tsx` + `components/tiktok-adgroup-row.tsx` (prop `readOnly` hides budget edit)
- Optional create (only if hub > 200 lines): `components/tiktok-fetch-panel.tsx` (move the idle/fetch card + notices out of hub)
- Delete: none

## Implementation Steps
1. `viewable-users.ts`: per data flow above. Sort by email. Select only non-token columns.
2. `page.tsx`: `getUserRole`, `getConnectionStatus(user.id)`, own rows `.eq('user_id', user.id).eq('is_selected', true)`, `loadTiktokStaffList` (Promise.all).
3. `tiktok-header.tsx`: props `staffList`, `viewingUserId`, `onViewingChange`, `userRole`; `<select>` styled like FB's (`campaign-hub.tsx` 555-571), first option "My accounts".
4. `tiktok-campaign-hub.tsx`: state `viewingUserId`; `activeAdvertisers = viewing ? viewing.accounts : selectedAdvertisers`; build fetch URL with `URL` + `searchParams.set('viewAs', …)`; on change reset `phase='idle'`, results, selection, filters; pass `viewAs`/`readOnly` to results panel; render read-only notice.
5. `tiktok-results-panel.tsx`: append `viewAs` to adgroup fetch; when readOnly do not render `<TiktokActionBar>` and pass `readOnly` to flat view. Row checkboxes stay (selection without an action bar is harmless — no table edits needed).
6. `tiktok-adgroup-flat-view.tsx` / `tiktok-adgroup-row.tsx`: `readOnly` hides the edit-budget button.
7. `npx tsc --noEmit`; check line counts (`wc -l`), split hub if > 200.

## Todo List
- [x] viewable-users loader
- [x] page.tsx per-user + staffList
- [x] header picker
- [x] hub viewAs state, reset, readOnly notice, copy fix
- [x] results panel viewAs + readOnly
- [x] flat view/row readOnly
- [ ] files < 200 lines (OPEN: `tiktok-campaign-hub.tsx` = 201 lines; split off e.g. the notice/picker bar)

## Success Criteria
- Staff: no picker; sees only own advertisers.
- Leader: picker lists connected team staff only; admin: all connected users.
- Viewing staff shows that staff's campaigns; no pause/enable/budget UI; switching back restores controls.

## Risk Assessment
| Risk | L x I | Mitigation |
|------|-------|-----------|
| Stale results from previous user shown after switch | M x M | Reset state on change; fetch keyed by viewingUserId |
| Ad-group fetch forgets viewAs -> mixes own + viewed data | M x M | Single `viewAs` prop, test 11 |
| listUsers 200-user cap (admin) | L x L | Same cap as FB/getVisibleUserIds; note only |

## Security Considerations
- Picker list is UX only; server re-checks every `viewAs` via `canViewAs`.
- Loader never selects token columns; nothing secret reaches the client component.

## Rollback
Revert commit.

## Next Steps
Phase 7 tests 9-12.
