# Test Matrix · Backwards Compatibility · Rollback

Companion to [plan.md](./plan.md). Repo has **no test framework** (no `test` script). Convention: `npx tsc --noEmit` + `npm run lint` + `npm run build` per phase, pure-function checks via scratch node scripts (Node 24 strips TS types; keep pure modules free of `@/` server imports), manual matrix below. Do not add a framework here.

## Test Matrix
| Layer | What to verify | How | Phase |
|---|---|---|---|
| Graph behaviour | window, min lead, targeting, scheduled photo >24h, DELETE, metrics, picture via signed URL | Phase 00 checklist on test Page | 00 |
| SQL | idempotent apply; 0 policies on token tables; own-row policy on others; anon cannot call `ps_claim_posts`; slot unique index rejects dup | Run block twice; `pg_policies`; anon-key `rpc` call | 01 |
| fb-client compat | existing error strings unchanged; no existing call site uses v26 | grep + smoke Dashboard, Spending Monitor, AFS | 01 |
| Error classifier / batch parser | code mapping, mixed batch response parsing | scratch script | 01 |
| Token add | valid -> exchanged long-lived, `expires_at` ~60d, page token `Expires: Never`; wrong-app token -> 400; missing hard scope -> 400 no row; missing env -> 500 config msg | manual per role | 02 |
| Dedupe | shared Page once; prefers CREATE_CONTENT; re-attach on profile removal | 2 tokens | 02 |
| Token leakage | no `*_enc`/`access_token` in any response | DevTools network grep | 02-06 |
| Time parsing | `YYYY-MM-DD HH:mm` = +07:00; ISO offsets honoured; garbage rejected | scratch script | 03 |
| Validator | every error/warning rule fires with row number | scratch script with fixture rows | 03 |
| Upload | 1000 rows + 50 images, no request >4.5 MB; missing image -> finalize 409; re-finalize OK | manual | 03 |
| Push happy path | text/url/upload rows scheduled, correct in Business Suite | test Page | 04 |
| Push concurrency | 2 tabs -> no duplicates | test Page | 04 |
| Push failures | past time, bad URL, 190, simulated transient -> correct status/backoff/halt | induced | 04 |
| Cancel | queued -> local; scheduled -> DELETE or explicit refusal | test Page | 04 |
| Reconcile | published flip; missing -> failed; stale pushing adopt/fail | test Page + manual DB edit | 05 |
| Metrics | counts saved; bad metric -> `metrics_error` only | test Page | 05 |
| Cron auth | no/wrong bearer -> 403 | curl | 05 |
| RBAC | staff own, leader own+team, admin all (`getVisibleUserIds`); `?owner=` outside set -> 403; any non-owner mutation -> 403 | curl per role | 02-06 |
| Deferred push | 33-day row -> `waiting`; cron pushes once in window; transient -> stays `waiting`; expired -> `failed` | test Page + DB time edit | 04-05 |
| Picture | MANAGE-only; path-prefix check | manual + forged call | 06 |

## Backwards Compatibility
- Purely additive: new tables (`ps_*`), new RPC, new bucket, new routes under `/api/page-scheduler/*` and `/api/cron/page-scheduler-sync`, new page `/page-scheduler`.
- Shared files touched: `supabase/schema.sql` (append), `lib/facebook/fb-client.ts` (additive: constant, `FbApiError` subclass with identical message, DELETE), `vercel.json` (new cron entry), `app/tools/page.tsx` (new card). No existing behaviour changes; no data migration.
- Reuses `AFS_TOKEN_ENCRYPTION_KEY`. New **required** env `FB_APP_ID`, `FB_APP_SECRET` (only read by this tool; other tools unaffected if absent).

## Rollback (per phase)
| Phase | Revert | Data |
|---|---|---|
| 01 | `git revert`; tables can stay (unused) or `drop table ps_posts, ps_batches, ps_settings, ps_pages, ps_fb_profiles cascade; drop function ps_claim_posts` | none shared |
| 02-04 | revert commits; remove card if added | stored tokens stay encrypted; delete rows if desired |
| 05 | remove cron entry from `vercel.json` + redeploy (stops deferred push + all background FB calls) | `waiting` rows stay unpushed -> push manually after re-enable or cancel |
| 06 | revert card/picture files | none |
- Posts already scheduled on Facebook are NOT removed by any rollback — list `status='scheduled'` rows first and cancel in Business Suite if the tool is withdrawn.
- Kill switch without deploy: delete the `ps_fb_profiles` rows (cascades pages) -> push/cron have no tokens.
