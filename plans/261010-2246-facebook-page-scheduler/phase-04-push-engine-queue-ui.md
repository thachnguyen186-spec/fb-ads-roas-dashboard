# Phase 04 — Push step engine + queue UI

## Context Links
- `lib/afs/publish-step.ts` (one bounded step per request, re-read DB each call, `persistOrThrow` never swallows FB ids)
- `app/api/afs-niche-testing/topics/[topicId]/publish/route.ts` + `review-publish-step.tsx` (client loop, resume, stop)
- Phase 01 RPC `ps_claim_posts`, `classifyFbError`, `fbDelete` · Phase 02 `getPageToken` · Phase 03 `media-storage.ts`
- Phase 00 results: window, cancel support, photo behaviour

## Overview
- Priority: P1 · Status: Implemented — pending live verification (blocked on Phase 00 + test Page) · Effort: 6h · Depends: 03 · Blocks: 05
- Client-driven, resumable loop pushes in-window `queued` rows to FB native scheduling and parks beyond-window rows as `waiting` (Phase 05 cron pushes them later via the same core); queue UI shows per-row status/error with retry, cancel, edit (unpushed only).

## Key Insights
- ~100 posts/day, up to 1000 per batch: never in one request. Each call claims <=10 rows, runs 5 concurrently, returns in ~5-15 s (`maxDuration = 60`).
- `FOR UPDATE SKIP LOCKED` claim makes 2 tabs / 2 loops safe (no double push).
- A row killed mid-request (FB succeeded, DB write lost) stays `pushing` -> NOT auto-retried (would duplicate); Phase 05 adopts it from `/{page}/scheduled_posts` or fails it as "uncertain".
- Native scheduled posts can't be edited; cancel = DELETE attempt only.
- Uploads reach 35 days but FB window is 29 (until spike): push core must be callable by both the client step and the cron -> `pushClaimedRows(rows, {requeueStatus})` exported from `push-step.ts`, no request/session dependency.

## Requirements
- Functional: push loop (start/stop/resume, progress counts), transient backoff, halt on 368, retry failed, cancel (local for unpushed; DELETE for scheduled), edit message/time/countries for `queued|waiting|failed` rows, delete batch (only if no row is `scheduled|published|pushing`), batch-level "cancel all unpushed" (`draft|queued|waiting`). Push/cancel/retry/edit/delete owner-only; leader/admin read-only on visible others' batches.
- Non-functional: idempotent per row; every FB id persisted or surfaced; files <200 lines.

## Architecture
```
POST /api/page-scheduler/batches/{id}/push  (owner only)
 pushStep(userId, batchId):
  1 expire: queued rows with scheduled_at < now+10m -> failed "Schedule time passed - edit time and retry"
  1b park: queued rows with scheduled_at > now+MAX_SCHEDULE_DAYS -> waiting (user approved; cron pushes when in window)
  2 rows = rpc ps_claim_posts('queued', batch, user, 10, now+10m, now+MAX_SCHEDULE_DAYS)
  3 pushClaimedRows(rows, {requeueStatus:'queued'}) — per row (concurrency 5): token = getPageToken(user, page_id) (profile invalid -> fail fast)
      pushPost(row, token):
        image none   -> POST /{page}/feed   message, published=false, scheduled_publish_time, [targeting]
        image url    -> POST /{page}/photos url, caption, published=false, scheduled_publish_time, [targeting]
        image upload -> fbPostMultipart /{page}/photos files{source: Blob(download path)} + same fields
        targeting = JSON {"geo_locations":{"countries":[...]}} only when countries non-empty
      ok   -> scheduled, fb_post_id (= post_id for photos), fb_photo_id, pushed_at, error null
      err  -> classifyFbError:
              transient & attempts<3 -> requeueStatus (error noted), response.backoff_ms = max(backoffMs(attempts))
              auth(190)  -> failed + markProfileInvalid
              blocked(368) -> failed, response.halt = message
              else       -> failed, error, error_code
  4 return {pushed, failed, requeued, waiting, remaining_queued, backoff_ms?, halt?, done: remaining_queued===0}
```
Client hook `use-push-loop.ts`: loop while !done && !stopped; 2 parallel loops; on `backoff_ms` show countdown then continue; on `halt` stop + red banner; on HTTP error stop with message; refetch batch after each step. Tab must stay open (UI notice); resumable anytime. Done banner: "N scheduled, M waiting — waiting posts are pushed automatically each hour once within 29 days".

Post actions (`post-actions.ts`):
- `cancelPost`: `draft|queued|waiting|failed` -> `cancelled` (local). `scheduled` -> `fbDelete(fb_post_id)` -> ok `cancelled` | error kept `scheduled` + returned message "Facebook refused cancel - delete in Meta Business Suite" (+ link `https://business.facebook.com/latest/posts/scheduled_posts`). If spike shows DELETE unsupported, UI hides cancel for scheduled rows and shows the link only.
- `retryPost`: `failed` (never had fb_post_id) -> `queued` (or `waiting` if beyond window), attempts 0, error null. Rows failed by reconcile "uncertain" require user confirm ("check Business Suite first").
- `editPost`: `queued|waiting|failed` only (status re-derived from new time); re-validate fields with `row-validation` single-row helper.

Routes:
| Route | Methods |
|---|---|
| `app/api/page-scheduler/batches/[batchId]/route.ts` | GET batch + posts (visible users, paged 200, status filter), DELETE batch (owner, guarded) |
| `app/api/page-scheduler/batches/[batchId]/push/route.ts` | POST step (`maxDuration = 60`) |
| `app/api/page-scheduler/batches/[batchId]/cancel-unpushed/route.ts` | POST |
| `app/api/page-scheduler/posts/[postId]/route.ts` | PATCH edit, DELETE cancel |
| `app/api/page-scheduler/posts/[postId]/retry/route.ts` | POST |

## Related Code Files
- Create: `lib/page-scheduler/push-post.ts`, `lib/page-scheduler/push-step.ts` (`pushStep` + exported `pushClaimedRows`), `lib/page-scheduler/post-actions.ts`, 5 route files above, `app/page-scheduler/components/queue-tab.tsx` (batch list + counts), `.../components/batch-detail.tsx` (post table + filters), `.../components/use-push-loop.ts`, `.../components/post-row-actions.tsx` (retry/cancel/edit dialog)
- Modify: `app/page-scheduler/components/page-scheduler-hub.tsx` (mount Queue tab); `lib/page-scheduler/row-validation.ts` (export single-row validator if not already)
- Delete: none

## Implementation Steps
1. `push-post.ts` (pure FB call builder + executor, returns ids or throws `FbApiError`).
2. `push-step.ts` (expire, claim, run, classify, persist with FB-id-preserving error like AFS `persistOrThrow`).
3. `post-actions.ts`.
4. Routes: GET via `resolveOwnerFilter` (visible users); every mutation `assertOwner`.
5. UI: batch list (name, created, counts by status), detail table (Bangkok time, page, snippet, image, countries, status badge incl. `waiting` ("auto-push after <date>"), owner column when >1 visible user, error, FB link; actions hidden on non-owned rows), Start/Stop/Resume push, spam-warning reminder, filters by status/page.
6. Manual run on test Page: 20 rows mixed text/url/upload, induce failures (bad URL, past time, revoked token).

## Todo List
- [x] push-post / push-step / post-actions
- [x] 5 routes
- [x] queue UI + push hook + row actions
- [ ] manual mixed-batch run incl. induced failures (BLOCKED: DB tables + test Page not available; pure parts scratch-tested)

## Success Criteria
- 20-row mixed batch -> all `scheduled`, visible in Business Suite planner with correct time/caption/image/targeting.
- Two tabs pushing same batch -> each row pushed exactly once (`fb_post_id` unique, planner count = row count).
- Closing tab mid-push then resuming completes remaining rows; no duplicates.
- Induced 4/17/32 (or simulated) -> row re-queued, loop backs off, continues. 190 -> profile `invalid` banner. Bad image URL -> row `failed` with FB message.
- Cancel scheduled post: either removed from planner (`cancelled`) or explicit refusal message.
- Row 33 days ahead -> `waiting` after push loop, not sent to FB; push loop reports `done`.
- Leader viewing staff batch sees rows, no action buttons; forged push/cancel -> 403.

## Risk Assessment
| Risk | L x I | Mitigation |
|---|---|---|
| Duplicate posts after crash | M x H | Stale `pushing` never auto-retried; Phase 05 adoption by scheduled_publish_time+message |
| Spam / 368 block across Pages | M x H | Halt loop on 368; upload-time warnings; stagger guidance |
| Rate limits | L x M | 5 concurrent, backoff, max 3 attempts |
| Function timeout on large photo upload | L x M | <=10 rows/step at concurrency 5; 4 MB cap; `maxDuration = 60` headroom; lower step size to 5 if p95 step >30 s |
| Scheduled photo dropped (24h rule) | L x H | Phase 00 gate; reconcile flags missing posts |

## Security Considerations
- Page tokens decrypted only inside push call scope; never returned/logged (log post id + FB error message only).
- `assertOwner` on push/cancel/retry/edit/delete; leaders/admins read-only on others' rows.
- `batchId`/`postId` UUID validated; queries always include `user_id`.

## Next Steps
- Phase 05 reconciles `scheduled` and stale `pushing` rows and fetches metrics.

## Sync-back deltas (2026-10-11)
- Push cutoff `PUSH_MIN_LEAD_MIN` = 12 min (was 10).
- Transient errors: only explicit rate-limit codes (4/17/32/341/613/80001) auto-requeue with `next_attempt_at` backoff. Other transient/network/5xx/photo-without-post_id outcomes fail as "Uncertain push outcome" to avoid duplicate posts.
- Cancel-near-publish guard added. Batch-delete race guarded.
- Live mixed-batch run, two-tab concurrency, and induced-failure checks still open (need Phase 00 + test Page).
