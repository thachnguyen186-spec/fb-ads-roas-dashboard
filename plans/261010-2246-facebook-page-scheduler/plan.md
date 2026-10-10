---
title: "Facebook Page Scheduler"
description: "New Tool Hub tool: bind many FB profile tokens, bulk-schedule posts to 20-50 Pages from CSV/JSON via FB native scheduling, per-post tier-1 geo targeting, profile-picture change, engagement analytics."
status: implemented-pending-verification
priority: P2
effort: 32h
branch: master
tags: [facebook-pages, graph-api-v26, scheduling, csv-upload, supabase-storage, cron, analytics, rbac]
created: 2026-10-10
updated: 2026-10-11
---

# Facebook Page Scheduler

Tool at `/page-scheduler`, open to **all roles**. Visibility like FB dashboard via `getVisibleUserIds` (staff own, leader self+team, admin all); only the **owner** mutates (non-owned rows read-only). Research: [researcher-261010-2239-facebook-page-scheduler-graph-api.md](../reports/researcher-261010-2239-facebook-page-scheduler-graph-api.md). Test matrix / compat / rollback: [test-matrix-rollback-compat.md](./test-matrix-rollback-compat.md).

## Status (2026-10-11)
Code complete, **uncommitted**. tsc/eslint/build clean. Pure-logic scratch tests 183/184 (1 cosmetic warning-text test). Code review 7.5/10; all Critical/High/Medium fixed. **Not live-verified**: no Graph spike, no DB apply, no deploy.

## Data flow
```
Settings: paste token -> (USER + env set: exchange long-lived) -> debug_token + /me -> ps_fb_profiles (enc)
          -> /me/accounts (paged) -> dedupe by page_id -> ps_pages (page_token_enc)
Upload:   CSV/JSON parsed + validated in browser (shared validator) -> POST /batches (server re-validates) -> rows 'draft' + signed upload URLs
          -> browser uploads images to Storage -> POST /finalize verifies objects -> rows 'queued' (<= 35 days ahead)
Push:     client loop -> POST /batches/{id}/push (RPC claim 10, concurrency 5) -> Graph v26 -> 'scheduled' | 'failed' | requeue
          rows beyond FB window (>29d) -> 'waiting'
Cron :15  push 'waiting' rows entering window, sweep idle 'queued', reconcile scheduled->published/failed, adopt stale 'pushing', refresh metrics
Analytics: GET /analytics -> top posts by engagement + per-page totals
```

## Phases
| # | Phase | Effort | Status | File |
|---|-------|--------|--------|------|
| 00 | Live API spike (manual, 1 test Page) | 2h | Pending — blocked on Page assignment | [phase-00](./phase-00-live-api-spike.md) |
| 01 | Schema + RPC + types + Graph v26 client/errors/batch | 4h | Implemented — pending live verification | [phase-01](./phase-01-schema-types-graph-client.md) |
| 02 | Token binding + page sync + tool shell + settings UI | 5h | Implemented — pending live verification | [phase-02](./phase-02-token-binding-page-sync-settings.md) |
| 03 | Templates + parse/validate + image upload + batch create | 6h | Implemented — pending live verification | [phase-03](./phase-03-csv-json-upload-validation.md) |
| 04 | Push step engine + queue UI (retry/cancel/edit) | 6h | Implemented — pending live verification | [phase-04](./phase-04-push-engine-queue-ui.md) |
| 05 | Deferred push + reconcile + metrics cron + analytics UI | 7h | Implemented — pending live verification | [phase-05](./phase-05-reconcile-metrics-analytics.md) |
| 06 | Profile picture + Tool Hub card + polish | 2h | Implemented — pending live verification (journal open) | [phase-06](./phase-06-profile-picture-hub-card.md) |

## Dependencies
`00 -> (gates constants in 01/04/05)` · `01 -> 02 -> 03 -> 04 -> 05` · `02 -> 06`.
**Gate:** Phase 00 results MUST be recorded before 04 pushes live rows (window, cancel, photo 24h rule, metric names).

## Scope changes (2026-10-11)
- User token is SYSTEM_USER: `FB_APP_ID`/`FB_APP_SECRET` made **optional** (reason: live check showed the user's token is a Business SYSTEM_USER token, which is already long-lived and needs no exchange). Impact: env only enables USER-token exchange and app_id check.
- Push lead 10 -> 12 min. Added queued-idle cron sweep (30 min). Added `next_attempt_at` backoff; uncertain-outcome failures instead of auto-retry (duplicate-post risk). Claim RPC gained `p_idle_minutes`.

## Remaining work (owner: user unless noted; main agent to drive)
1. **Phase 00 spike**: assign 1 test Page to system user; run steps 1-13; record in phase-00 table; set `MAX_SCHEDULE_DAYS`, `METRIC_NAMES`, cancel flag.
2. Apply `supabase/schema.sql` lines 291-442 in Supabase SQL editor (twice; idempotency). Verify `pg_policies` and anon `rpc` denial.
3. Create private bucket `page-scheduler-media`: 4 MB limit, MIME `image/jpeg,image/png,image/gif`.
4. Set `CRON_SECRET` in Vercel (optional: `FB_APP_ID`/`FB_APP_SECRET`).
5. Deploy; confirm cron `/api/cron/page-scheduler-sync` in Vercel; curl with Bearer once.
6. Live e2e on test Page: 20-row mixed batch, two-tab push, induced failures, cancel, picture change, RBAC curl matrix.
7. Write `docs/journals/` entry (phase 06) and changelog/roadmap update.
8. Commit (conventional commits, no secrets, `plans/` review first).

**Main agent: finish this plan. Phase 00 spike and live verification are gating items; do not ship phase 04 push to real users before step 1 is recorded.**

## Unresolved questions
1. Spike results: FB window 29 vs 75 days; min-lead error code; DELETE cancel on scheduled feed/photo; targeting hard vs soft; scheduled photo survives >24h; v26 metric names; business-portfolio Pages in `/me/accounts`.
2. Does the SYSTEM_USER token need Page assignments beyond the test Page for production Pages (count and assets)?
3. Should `CRON_PUSH_LIMIT`/`QUEUED_IDLE_MIN` be tuned after first live week?
