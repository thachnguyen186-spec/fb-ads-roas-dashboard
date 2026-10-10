# Phase 05 — Deferred push + reconcile + metrics cron + analytics UI

## Context Links
- `app/api/cron/check-spending-limits/route.ts` (CRON_SECRET timing-safe auth, grouping by user) · `vercel.json` (hourly cron exists -> Vercel Pro)
- Phase 01 `graph-batch.ts`, `classifyFbError`, `ps_claim_posts` · Phase 02 `getPageToken`, `markProfileInvalid`, `access.ts` · Phase 04 `pushClaimedRows` · Phase 00 metric names

## Overview
- Priority: P1 (deferred push) / P2 (rest) · Status: Implemented — pending live verification (deploy cron, CRON_SECRET, test Page) · Effort: 7h · Depends: 04
- Hourly job pushes `waiting` rows that entered the FB window, confirms scheduled posts actually published, adopts/fails stale pushes, refreshes engagement; Analytics tab ranks posts and totals per Page.

## Key Insights
- Reports of scheduled posts silently not appearing -> must verify, not assume.
- `GET /?ids=` gone 2026-10-27 -> batch `POST /` only (50/req), grouped per Page so one page token per batch.
- Metric names on v26 partly unverified -> engagement core = reactions + comments + shares (fields, stable); insights metrics best-effort, per-post `metrics_error`.
- Metrics stored as latest snapshot on `ps_posts` (no time series - YAGNI).
- Deferred push is time-critical -> runs FIRST each cron run; ~100 posts/day enter the window (~5/h), so `CRON_PUSH_LIMIT=30` per run absorbs backlog; a missed hour only delays (rows stay pushable until now+10m).

## Requirements
- Functional: (0) deferred push: expire `waiting` rows with `scheduled_at < now+10m` -> `failed` "Missed push window (cron outage) - edit time and retry"; claim `rpc ps_claim_posts('waiting', null, null, CRON_PUSH_LIMIT, now+10m, now+MAX_SCHEDULE_DAYS)` -> `pushClaimedRows(rows, {requeueStatus:'waiting'})` (transient -> back to `waiting` for next hour, attempts<3; 190 -> profile invalid; 368 -> row failed + skip that page's remaining claims this run (release back to `waiting`)); per-row status/error visible in Queue; (a) `scheduled` rows past `scheduled_at + 15 min` -> `published` (+`published_at`, `permalink_url`) / `failed` (missing, or still unpublished >2 h after time); (b) `pushing` rows with `claimed_at` > 10 min -> match against `GET /{page}/scheduled_posts?fields=id,message,scheduled_publish_time` (same unix time + message prefix) -> `scheduled` with adopted id, else `failed` "Uncertain push outcome - check Business Suite before retry"; (c) metrics for `published` rows with `published_at` within 14 days and `metrics_at` null or >6 h old (oldest first, cap 600/run).
- Analytics: filter date range (Bangkok), page, batch; sort by engagement / reactions / comments / shares / views / clicks; top 200 posts; per-page totals (posts, sum engagement, avg per post, best post).
- Non-functional: run <=50 s (time guard, leftovers next hour); per-page failure isolated; never throws whole job on one bad token.

## Architecture
```
vercel.json: { path: "/api/cron/page-scheduler-sync", schedule: "15 * * * *" }
GET /api/cron/page-scheduler-sync  (Bearer CRON_SECRET, timing-safe; maxDuration 60)
  pushDueWaiting()      -> expire stale waiting -> claim <=30 waiting in window -> pushClaimedRows (concurrency 5) -> stop claiming at deadline-20s
  reconcileScheduled()  -> group rows by (user,page) -> graphBatch(pageToken, [{GET <fb_post_id>?fields=is_published,permalink_url,created_time}])
                           item 100/33 -> failed "Post missing on Facebook" ; 190 -> markProfileInvalid, skip page
  adoptStalePushing()   -> per page 1 call to /scheduled_posts (+ /published_posts?since if time passed) -> adopt/fail
  refreshMetrics()      -> per page graphBatch: <id>?fields=shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)
                           and <id>/insights?metric=METRIC_NAMES -> update counts, metrics_at, metrics_error
  -> {deferred_pushed, deferred_failed, reconciled, adopted, failed, metrics_updated, skipped_pages, ms}
GET /api/page-scheduler/analytics?from&to&page_id&batch_id&sort&owner
  -> top posts: select ... where status='published' order by <sort> desc nulls last limit 200
  -> totals: select page_id, page_name, engagement, views for range -> aggregate in TS (<=~3000 rows)
```
Optional manual trigger for dev: curl with CRON_SECRET (no user-facing button - YAGNI).

## Related Code Files
- Create: `lib/page-scheduler/deferred-push.ts` (`pushDueWaiting(deadline)`), `lib/page-scheduler/reconcile-posts.ts` (scheduled + stale pushing), `lib/page-scheduler/metrics-sync.ts`, `lib/cron-auth.ts` (`verifyCronRequest(request)` — generic, same timing-safe logic; existing spending cron left untouched to avoid regression, can adopt it later), `app/api/cron/page-scheduler-sync/route.ts`, `app/api/page-scheduler/analytics/route.ts`, `app/page-scheduler/components/analytics-tab.tsx`, `app/page-scheduler/components/analytics-page-totals.tsx`, `app/page-scheduler/components/analytics-top-posts.tsx`
- Modify: `vercel.json` (add cron), `app/page-scheduler/components/page-scheduler-hub.tsx` (mount Analytics tab)
- Delete: none

## Implementation Steps
1. `lib/cron-auth.ts` (timing-safe Bearer check returning `Response | null`).
2. `deferred-push.ts` reusing Phase 04 `pushClaimedRows` (no duplicated FB logic).
3. `reconcile-posts.ts` with page grouping, token cache per run, time guard.
4. `metrics-sync.ts` parsing summaries (`reactions.summary.total_count`, `comments.summary.total_count`, `shares.count` absent -> 0) and insights `data[].values[0].value`.
5. Cron route orchestrating deferred push -> reconcile -> metrics under shared deadline.
6. Analytics route: `resolveOwnerFilter` (staff own, leader team, admin all; optional `?owner=`), owner labels via `ownerLabels` when >1 visible user.
7. Analytics UI (owner filter for leader/admin): filters bar, per-page totals table, top posts table (permalink, snippet, page, time, counts, engagement), CSV export of current view (client-side, papaparse unparse) - optional if <30 min.
8. Deploy; confirm cron registered in Vercel dashboard; curl once manually.

## Todo List
- [x] cron-auth / deferred-push / reconcile-posts / metrics-sync
- [x] cron route + vercel.json
- [x] analytics route + 3 UI components
- [ ] deployed cron verified (needs DB tables + CRON_SECRET in Vercel)

## Success Criteria
- Row uploaded 33 days ahead stays `waiting`, becomes `scheduled` in the first cron run after it enters the 29-day window (test by temporarily lowering `MAX_SCHEDULE_DAYS` or editing `scheduled_at`); a forced-failure row shows `failed` + error in Queue.
- Test batch: all posts flip `scheduled -> published` within 1 h after their time; deleting one in Business Suite before publish -> `failed` "missing".
- Simulated stale `pushing` row (manually set `claimed_at` old) adopted when the FB post exists, failed otherwise.
- Published posts show counts within 6 h; invalid metric name -> counts still saved, `metrics_error` set.
- Analytics sorts correctly; per-page totals equal sum of rows; staff sees own, leader own+team, admin all; `?owner=` outside visible set -> 403.
- Cron run completes <50 s with 50 pages / 1,500 tracked posts (log `ms`).

## Risk Assessment
| Risk | L x I | Mitigation |
|---|---|---|
| Batch sub-requests hit rate limits | L x M | 50 pages x ~4 batches/h well under page budget; transient -> skip page this run |
| Wrong adoption match (similar captions) | L x M | Require exact unix time + same page + message prefix 100 chars; ambiguous (>1 match) -> fail "uncertain" |
| Cron overruns | M x L | Deadline guard; oldest-first ordering guarantees progress |
| Unattended push fails silently | M x M | Per-row `failed` + error in Queue; waiting/failed counts on batch list; cron logs counts |
| Cron down for days -> waiting rows miss slot | L x M | Rows stay pushable until now+10m; expired ones flagged for edit+retry |
| Metrics deprecated again | M x L | Constants list; tolerate errors |

## Security Considerations
- Cron route rejects without exact `Bearer CRON_SECRET` (timing-safe). Service client only; no user input.
- Deferred push only touches rows already approved by their owner (pushed through the client step, or edited/retried by owner); uses owner's page token.
- Analytics route: filter limited to `getVisibleUserIds`; read-only.

## Next Steps
- After spike: if window is 75 days, set `MAX_SCHEDULE_DAYS` >= 35 and deferred push becomes a no-op (keep as safety net).

## Sync-back deltas (2026-10-11)
- Added: cron sweep of `queued` rows idle >30 min (`queued-sweep.ts`, `CRON_QUEUED_LIMIT`=30) for abandoned browser loops.
- Added: `next_attempt_at` backoff honoured by claim; reconcile/metrics caps `RECONCILE_MAX_POSTS_PER_RUN`/`METRICS_MAX_POSTS_PER_RUN`=300; `CRON_BUDGET_MS`=50 s.
- Added: starvation guard for cron claims; `DISCONNECTED_FAIL_HOURS`=6 fails rows of token-less pages.
- Cron route is pending deploy: `vercel.json` entry present; Vercel cron registration, `CRON_SECRET` and curl check still open.
