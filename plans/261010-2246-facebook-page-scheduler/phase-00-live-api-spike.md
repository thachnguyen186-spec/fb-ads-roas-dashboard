# Phase 00 — Live API spike (manual)

## Context Links
- Research: `plans/reports/researcher-261010-2239-facebook-page-scheduler-graph-api.md` (items marked [U]/[T])
- Graph API Explorer: https://developers.facebook.com/tools/explorer/ · Access Token Debugger: https://developers.facebook.com/tools/debug/accesstoken/

## Overview
- Priority: P1 (gates constants used in Phases 01/04/05) · Status: Pending — blocked on Page assignment (0 Pages assigned to the user's SYSTEM_USER token, 2026-10-10) · Owner: user/dev · Effort: 2h
- Unblock: assign one throwaway Page to the system user (Business Settings → Users → System users → Assign assets), then run steps 1-13.
- Verify every unverified Graph behaviour on ONE throwaway test Page before code depends on it. No app code written.

## Key Insights
- Docs conflict on schedule window (30 vs 75 days) and on whether scheduled posts can be deleted.
- `published` defaults to true: every test call MUST include `published=false` or the post goes live.
- Use a Page with no real audience; delete all test posts afterwards.

## Requirements
- Profile used has an app role on the token-issuing app; token scopes: `pages_show_list, pages_manage_posts, pages_read_engagement, read_insights`.
- All calls against `https://graph.facebook.com/v26.0`.

## Architecture
N/A (manual). Results recorded in a table appended to this file ("Spike results") and transferred into `lib/page-scheduler/constants.ts` (Phase 01).

## Related Code Files
- Create: none. Modify: this file (results section). Delete: none.

## Implementation Steps (checklist; record request, response, verdict)
1. **Page tokens**: exchange the pasted token via `GET /oauth/access_token?grant_type=fb_exchange_token&client_id=FB_APP_ID&client_secret=FB_APP_SECRET&fb_exchange_token=...`, then `GET /debug_token?input_token=...&access_token=FB_APP_ID|FB_APP_SECRET` (record `expires_at`, `app_id`), then `GET /me/accounts?fields=id,name,tasks,access_token`. Paste a page token in Access Token Debugger: confirm `Expires: Never` when the user token was extended (Debugger "Extend") vs ~1h when not. Note whether business-portfolio Pages appear.
2. **Window**: `POST /{page}/feed` `message=t1&published=false&scheduled_publish_time=<now+29d>` (expect OK) then `<now+31d>` and `<now+74d>`. Record the max accepted. Also `<now+5min>` (expect error; record code/message).
3. **Text + targeting**: schedule +15 min with `targeting={"geo_locations":{"countries":["US","GB"]}}`. After publish, view from a VN account (or VPN-less local profile): visible/hidden? Record whether targeting is a hard restriction.
4. **Scheduled photo (url)**: `POST /{page}/photos` `url=<public https jpg>&caption=t3&published=false&scheduled_publish_time=<now+26h>` -> record `{id, post_id}`; after 26h confirm it published (24h unpublished-upload rule does NOT kill scheduled photos).
5. **Scheduled photo (multipart)**: same as 4 with multipart `source` file (curl `-F source=@img.jpg`). Confirm accepted + targeting accepted on /photos.
6. **Business Suite**: confirm 2-5 appear in Meta Business Suite planner.
7. **List**: `GET /{page}/scheduled_posts?fields=id,message,scheduled_publish_time` shows them; record id format (`{page}_{post}`) and that it matches ids returned in 2-5 (for photos: `post_id`, not photo `id`).
8. **Cancel**: `DELETE /{post-id}` on a scheduled feed post and a scheduled photo post -> record success/error; confirm gone from planner.
9. **Edit time** (info only): `POST /{post-id}` `scheduled_publish_time=<new>` -> record (plan does not depend on it).
10. **Status**: `GET /{post-id}?fields=is_published,permalink_url,created_time` before and after publish.
11. **Metrics** (on a published post): `GET /{post-id}?fields=shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)` and `GET /{post-id}/insights?metric=post_media_view,post_total_media_view_unique,post_clicks` -> record which metric names are valid.
12. **Batch**: `POST /` with `batch=[{"method":"GET","relative_url":"<post-id>?fields=is_published"} x2]` -> confirm per-item `code`/`body` shape.
13. **Profile picture**: `POST /{page}/picture` `picture=<Supabase signed URL, 10 min TTL>` -> confirm it updates (FB fetches immediately).

## Todo List
- [ ] Steps 1-13 executed and recorded
- [ ] `MAX_SCHEDULE_DAYS`, `METRIC_NAMES`, cancel support flag decided
- [ ] Test posts deleted

## Success Criteria
- Results table filled with a verdict for each of: window max, min lead error code, targeting hard/soft, scheduled photo survives >24h, DELETE works (feed/photo), valid metric names, picture via signed URL.

## Risk Assessment
| Risk | L x I | Mitigation |
|---|---|---|
| Accidental live post | M x M | Always `published=false`; throwaway Page |
| DELETE unsupported | M x M | Cancel UI then degrades to "delete in Business Suite" link (Phase 04 handles both) |
| Scheduled photo dropped at 24h | L x H | Fall back: cap photo rows to <24h ahead OR switch to deferred pusher (escalate to user) |
| Targeting is soft only | M x L | Document in UI ("audience preference, not a hard block") |

## Security Considerations
- Do not paste tokens into tickets/chat; revoke test tokens after spike.

## Next Steps
- Feed results into Phase 01 constants; if step 4 fails, re-plan Phase 04 window for photos before coding it.

## Spike results
| Item | Result | Date |
|---|---|---|
| (fill in) | | |
