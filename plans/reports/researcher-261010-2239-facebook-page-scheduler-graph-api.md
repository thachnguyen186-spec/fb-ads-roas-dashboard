# Facebook Pages Graph API — page scheduler research (2026-10-10)

Legend: [D] Meta doc · [T] third-party only · [U] unverified/conflicting → test on 1 real Page before relying.

## Version
- Latest **v26.0** (2026-07-29). Pin v26.0. v21.0 expires 2027-01-21. Repo uses v21.0 / v22.0 (lib/facebook/fb-client.ts).
- From 2026-10-27 `GET /?ids=` root requests + `date_format` error on all versions → use batch `POST /` instead.

## 1. Tokens
- Pages: `GET /v26.0/me/accounts?fields=id,name,category,picture,access_token,tasks&limit=100` → follow `paging.next`. [D]
- Long-lived user token (~60d): `GET /oauth/access_token?grant_type=fb_exchange_token&client_id&client_secret&fb_exchange_token` (needs app id/secret). [D]
- Page tokens derived from long-lived user token: no expiry unless invalidated (password change, role removed, app deauth [T]). Unique per Page+admin+app. [D]
- `GET /debug_token?input_token=…&access_token=APP_ID|APP_SECRET` → is_valid, expires_at, scopes. [D]
- Business-portfolio Pages may be missing from /me/accounts; `/{business-id}/owned_pages` needs `business_management` [T/U].

## 2. Permissions
| Capability | Permissions | Page task |
|---|---|---|
| List Pages | pages_show_list | – |
| Publish feed/photo | pages_manage_posts, pages_read_engagement, pages_show_list | CREATE_CONTENT |
| Post insights | read_insights, pages_read_engagement | ANALYZE |
| Profile picture | pages_read_engagement, pages_show_list | MANAGE |
| Page settings | pages_manage_metadata | MANAGE |
- Standard Access (dev mode) = only users with app role (admin/developer/tester). Advanced Access = Business Verification + App Review. → every FB profile whose token is added must have an app role on the app that issued the token, unless the app has Advanced Access.

## 3. Native scheduling
- `POST /{page-id}/photos`: `url` (public) or multipart `source`, `caption`, `published=false`, `scheduled_publish_time` (unix), `targeting`. [D]
- `POST /{page-id}/feed`: `message`, `link`, `published=false`, `scheduled_publish_time`, `targeting`. [D]
- Window: feed ref says 10 min–75 days; Pages guide says 10 min–30 days [U] → design for 30 days.
- `published` defaults true → ALWAYS send `published=false` or post goes live immediately.
- Unpublished photo uploads deleted if not published in 24h [D] — applies to scheduled photos? [U]
- List: `GET /{page-id}/scheduled_posts` (GET only). Post node: `is_published`, `scheduled_publish_time`.
- Edit/cancel scheduled post: Post ref says update/delete not allowed [D]; third-party says `DELETE /{post-id}` works [T] → **unreliable, spike-test**.
- Business Suite planner visibility [T]. No documented per-Page cap on scheduled posts. Reports of occasional missing scheduled posts [T] → reconcile.

## 4. Geo restriction
- Per-post `targeting.geo_locations.countries` on /feed and /photos (Pages only) = documented way to "limit who can see a Page post". /photos also accepts `excluded_countries`. `feed_targeting` = older suggest-style. Use `targeting`. Hard-restrict behavior for non-target viewers [U] → test.
- Page-level country restriction: **no API field/option documented** → not via API; Page settings UI only.

## 5. Profile picture / cover
- `POST /{page-id}/picture` with `picture=<url>` or `photo=<photo id>`; MANAGE task. Present in v26 ref. [D]
- Cover: `POST /{page-id}` `cover` — EDIT_PROFILE + business_management; one report of "Invalid id" on v22–24 [T]. Out of scope.

## 6. Analytics
- Engagement: `?fields=shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)` [T syntax, standard].
- Insights `GET /{post-id}/insights` (read_insights). Removed: post_impressions*, post_impressions_unique etc. (2025 waves). Active: `post_media_view`, `post_total_media_view_unique`, `post_clicks`, `post_reactions_*_total` (`post_reactions_by_type_total` [U]); `post_engaged_users` not found [U].
- Batch: `POST /v26.0/` `batch=[…]` max 50 sub-requests, non-atomic, each counts toward limits.

## 7. Rate limits
- Page: 4800 × engaged users / 24h; app: 200 × users / hour; BUC header `X-Business-Use-Case-Usage`. Errors 4, 17, 32, 613, 80001.
- No documented per-Page daily publish cap ("25/day" [T]). 100 posts/day across 50 Pages is well under budgets.
- Spam risk: identical content across many Pages is a known spam pattern [T] → vary captions, stagger times.

## 8. Images
- `url`: publicly reachable at request time; formats jpeg/bmp/png/gif/tiff; max 4 MB (png 1 MB). HTTPS requirement [U]. Multipart `source` alternative. Avoid short-lived signed URLs.

## Test spike before build (1 test Page, profile with app role)
a) 30 vs 75-day window · b) DELETE /{post-id} cancels scheduled post? · c) change scheduled_publish_time? · d) targeting hides post from non-target country · e) scheduled photo vs 24h rule · f) post metrics valid on v26 · g) business-owned Pages in /me/accounts.

## Unresolved
1. Scheduling window 30 vs 75 days. 2. Edit/cancel scheduled posts. 3. targeting = hard restriction? 4. Per-Page scheduled caps. 5. Scheduled photo 24h rule. 6. Valid engagement metrics on v26. 7. Business-owned Pages + permission. 8. Does pages_read_engagement need App Review. 9. Which FB app issues the pasted tokens (app role requirement).

## Sources
- https://developers.facebook.com/docs/graph-api/changelog/version26.0
- https://developers.facebook.com/docs/pages-api/posts
- https://developers.facebook.com/docs/graph-api/reference/page/feed/
- https://developers.facebook.com/docs/graph-api/reference/page/photos/
- https://developers.facebook.com/docs/graph-api/reference/page/scheduled_posts/
- https://developers.facebook.com/docs/graph-api/reference/page/picture/
- https://developers.facebook.com/docs/graph-api/reference/user/accounts/
- https://developers.facebook.com/docs/pages/access-tokens/
- https://developers.facebook.com/docs/graph-api/overview/access-levels/
- https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
- https://developers.facebook.com/docs/graph-api/batch-requests/
- https://developers.facebook.com/docs/graph-api/reference/insights/
- https://developers.facebook.com/documentation/pages-api/platforminsights/page/deprecated-metrics
