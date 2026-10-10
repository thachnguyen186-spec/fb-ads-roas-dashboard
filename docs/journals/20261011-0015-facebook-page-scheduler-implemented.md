# Facebook Page Scheduler Implemented (Unverified Live)

**Date**: 2026-10-11 00:15
**Severity**: High (writes real posts to live Pages; duplicate-post risk)
**Component**: Facebook integration / Page Scheduler tool (`/page-scheduler`)
**Status**: Ongoing. Code complete and reviewed. Blocked on DB migration, Page assignment, and a live Phase 00 spike before any real use.

## What Happened

Built a new Tool Hub tool, Page Scheduler. Operators bind many Facebook tokens (USER or Business Manager SYSTEM_USER), sync Pages via `/me/accounts`, upload a CSV/JSON of posts, and the tool pushes them to Facebook's **native** scheduling (`published=false` + `scheduled_publish_time`, Graph v26 pinned). Includes a Queue (retry/cancel/edit), an Analytics tab, and a page profile-picture change. An hourly cron (`/api/cron/page-scheduler-sync`, at :15) handles deferred pushes, sweeps idle queued rows, reconciles scheduled→published, and refreshes metrics.

Plan and research: `plans/261010-2246-facebook-page-scheduler/` and `plans/reports/researcher-261010-2239-facebook-page-scheduler-graph-api.md`. Setup doc: `docs/page-scheduler-setup.md`.

## The Brutal Truth

The live token discovery was the most painful moment. The user's token is a SYSTEM_USER token with every scope we need, and `/me/accounts` returns **zero Pages**, because nothing is assigned to the system user. Half the design assumed Pages would simply appear. They didn't. We made `FB_APP_ID`/`FB_APP_SECRET` optional because `debug_token` works with the token itself.

The code review scored it 7.5/10. The findings that mattered most were ones that could have posted something twice or let a browser forge state. The RLS hole is the one that makes me wince: the service-written `ps_*` tables had write policies, so any browser JWT could forge metrics, change status, or flip an uncertain row back to `queued`, causing a duplicate post. We would have shipped that if the review hadn't happened.

Nothing about this is verified against the real Graph API. Tests were pure-logic scratch tests and unauth smoke tests. Treat this as "compiles and is defensively written," not "works."

## Technical Details

- **Scheduling**: rows go to FB with `published=false` + `scheduled_publish_time`. Per-post `targeting.geo_locations.countries` (default tier-1: US GB CA AU NZ IE DE FR NL SE NO DK FI). Page-level country restriction is not exposed by the API, so per-post targeting is the only option.
- **Window**: uploads up to 35 days ahead. Rows more than 29 days out are held as `waiting`; the hourly cron pushes them once they enter the window. The 29 vs 75-day window is still unconfirmed.
- **Timezone**: Bangkok by default.
- **Images**: image URL or uploaded file, stored in private Supabase bucket `page-scheduler-media` (4MB, jpeg/png/gif).
- **Ownership (RBAC)**: staff own their rows, leaders see their team, admins see all. Only the owner can mutate.
- **Review fixes**:
  - RLS write bypass closed (`ps_*` policies are select-only).
  - Storage path checked before download.
  - Cancel refused within 60s of publish (a DELETE would kill a live post).
  - Network/1/2/5xx push errors, and photo-without-`post_id`, mark the row **"Uncertain push outcome"**, which requires human confirm. No auto-retry.
  - Batch-delete vs push race fixed.
  - Server-side `next_attempt_at` backoff.
  - Cron starvation by token-less pages fixed.
  - `scheduled_posts` paging added.
  - Upload signing concurrency capped, `maxDuration` set, push lead 12 min.
- **Tester fix**: JSON with unquoted 17-digit page IDs lost precision (JS number). Page IDs now parsed as strings.

## What We Tried

- Assumed `/me/accounts` would list Pages for the system user. It returned an empty array.
- Assumed FB app credentials were required. `debug_token` on the token itself was enough, so they're now optional.
- Assumed a write-protected table pattern carried over from other services. It did not, and the RLS write policies were a live attack surface until review.
- Retry-on-error for pushes. Rejected: a timeout after FB accepted the post is indistinguishable from a timeout before it, so auto-retry duplicates posts.

## Root Cause Analysis

Native scheduling hands state to Facebook. Once we call the API, the post exists on FB's side, but our DB may not know. Any ambiguous write outcome (timeout, 5xx, photo upload without a `post_id`) is therefore unknown, not failed. The initial design treated every error as retryable, which is the wrong default for a non-idempotent write.

Separately, the RLS mistake happened because we treated "the server writes these tables" as implying "clients can't write them." Supabase policies are what clients can do, regardless of who the service is.

## Lessons Learned

1. **Ambiguous write outcomes are "uncertain," never "retryable."** For non-idempotent external writes, an auto-retry after a timeout is a duplicate-post generator. Surface it to a human.
2. **Service-written tables must have no client write policies.** Grant select only, and verify with an actual JWT, not by reading the migration.
3. **Don't assume a token's Page list.** Check `/me/accounts` and the assignment state in Business Manager before designing around it.
4. **Verification scope has to match risk.** Pure-logic tests and 401 smoke checks don't prove the Graph integration. Don't call this "done" until the spike runs.

## Next Steps

Owner: user (Pending, in order):
1. Assign Pages to the system user in Business Manager.
2. Apply `supabase/schema.sql` lines 291-442 to the database.
3. Create the `page-scheduler-media` bucket (4MB, jpeg/png/gif, private).
4. Set `CRON_SECRET` in Vercel.
5. Run the **Phase 00 live spike before real use**: 29 vs 75-day window, DELETE cancel behavior, targeting hard-restrict, scheduled photo >24h, v26 metric names.
6. End-to-end test with a throwaway Page.

Do not schedule real customer posts until steps 5 and 6 pass.

**Unresolved questions**:
- Does FB accept scheduled photos more than 24h out?
- Is the scheduling window 29 or 75 days for our token type?
- Do v26 insight metric names match what we query?
