# Phase 01 — Schema, RPC, types, Graph v26 client

## Context Links
- `supabase/schema.sql` (AFS block L207-289 = pattern: service-only token table, own-row policies)
- `lib/facebook/fb-client.ts` (`AFS_FB_API_BASE` pattern, `parseAndThrow`, `fbPostMultipart`)
- `lib/crypto/token-crypto.ts` (`encryptToken(plain, userId)` AAD-bound; reuse as-is)
- Phase 00 results

## Overview
- Priority: P1 · Status: Implemented — pending live verification (SQL apply + bucket + pg_policies checks) · Effort: 4h · Blocks: 02-06
- One SQL block (applied manually once), tool types, constants, and an additive Graph layer that exposes FB error codes.

## Key Insights
- `fbGet/fbPostForm` throw plain `Error(message)` -> codes lost; rate-limit/backoff needs `code`/`error_subcode`. Fix additively: throw `FbApiError extends Error` with same message (all existing callers unaffected).
- `fbRequest` lacks DELETE -> add `fbDelete`.
- `GET /?ids=` removed 2026-10-27 -> batch only via `POST /` (`batch=` JSON, <=50).
- Atomic multi-row claim needs SQL (`FOR UPDATE SKIP LOCKED`) -> RPC, mirrors existing `security definer` function style in schema.sql.
- `lib/types.ts` is 405 lines -> tool types in own file.

## Requirements
- Functional: tables `ps_fb_profiles`, `ps_pages`, `ps_settings`, `ps_batches`, `ps_posts`; RPC `ps_claim_posts`; v26 base; error classifier; batch helper.
- Non-functional: idempotent SQL (`if not exists`, `create or replace`); no behaviour change for existing tools.

## Architecture — data model (append to schema.sql under `-- ─── Page Scheduler ───`)
| Table | Key columns | RLS |
|---|---|---|
| `ps_fb_profiles` | `id uuid pk`, `user_id fk auth.users cascade`, `fb_user_id`, `fb_user_name`, `token_enc`, `expires_at timestamptz` (long-lived user token, from debug_token; page tokens never expire), `granted_scopes text[]`, `status ('active'/'invalid')`, `last_error`, `synced_at`, timestamps; `unique(user_id, fb_user_id)` | enabled, **no policies** |
| `ps_pages` | `id pk`, `user_id`, `profile_id fk ps_fb_profiles cascade`, `page_id text`, `name`, `category`, `picture_url`, `tasks text[]`, `page_token_enc`, `is_active bool`, `synced_at`; `unique(user_id, page_id)` | enabled, **no policies** (holds ciphertext) |
| `ps_settings` | `user_id pk`, `default_countries text[] default '{US,GB,CA,AU,NZ,IE,DE,FR,NL,SE,NO,DK,FI}'`, `updated_at` | own-row `for all` |
| `ps_batches` | `id`, `user_id`, `file_name`, `source_type ('csv'/'json')`, `status ('awaiting_media'/'ready')`, `row_count`, timestamps | own-row |
| `ps_posts` | `id`, `batch_id fk cascade`, `user_id`, `row_number`, `page_id`, `page_name` (snapshot), `scheduled_at timestamptz`, `message`, `image_kind ('none'/'url'/'upload')`, `image_ref` (https URL or storage path), `countries text[]` (empty = no targeting), `status ('draft','queued','waiting','pushing','scheduled','published','failed','cancelled')` (`waiting` = approved but beyond FB window; cron pushes later), `attempts int`, `claimed_at`, `fb_post_id`, `fb_photo_id`, `permalink_url`, `error`, `error_code int`, `pushed_at`, `published_at`, metrics `reactions, comments, shares, views, unique_views, clicks int`, `engagement int generated always as (coalesce(reactions,0)+coalesce(comments,0)+coalesce(shares,0)) stored`, `metrics_at`, `metrics_error`, timestamps | own-row |

Indexes: `ps_posts(batch_id, status)`, `ps_posts(scheduled_at) where status='waiting'` (cron scan), `ps_posts(status, scheduled_at)`, `ps_posts(user_id, published_at)`, unique `ps_posts(fb_post_id) where fb_post_id is not null`, **unique slot guard** `ps_posts(user_id, page_id, scheduled_at) where status not in ('cancelled','failed')` (DB backstop vs double upload), `ps_pages(profile_id)`.

RPC (service-role only — `revoke execute ... from public, anon, authenticated`). Shared by client step (`p_status='queued'`, batch+user set) and cron deferred push (`p_status='waiting'`, batch/user null = all):
```sql
create or replace function public.ps_claim_posts(p_status text, p_batch_id uuid, p_user_id uuid, p_limit int,
  p_earliest timestamptz, p_latest timestamptz) returns setof public.ps_posts
language sql security definer set search_path = public as $$
  update public.ps_posts p set status='pushing', claimed_at=now(), attempts=p.attempts+1, updated_at=now()
  where p.id in (select id from public.ps_posts where status=p_status and p_status in ('queued','waiting')
    and (p_batch_id is null or batch_id=p_batch_id) and (p_user_id is null or user_id=p_user_id)
    and scheduled_at between p_earliest and p_latest
    order by scheduled_at, row_number limit p_limit for update skip locked)
  returning p.*;
$$;
```

Graph layer:
- `fb-client.ts`: `export const PAGE_SCHEDULER_FB_API_BASE = 'https://graph.facebook.com/v26.0'`; `export class FbApiError extends Error { code?; subcode?; }` thrown by `parseAndThrow` (message format unchanged); method union adds `'DELETE'`; `export function fbDelete(path, token, baseUrl)`.
- `graph-errors.ts`: `classifyFbError(err) -> 'transient' | 'auth' | 'blocked' | 'permission' | 'not_found' | 'invalid' | 'unknown'` — transient: 1, 2, 4, 17, 32, 341, 613, 80001; auth: 190, 102; blocked: 368; permission: 10, 200-299; not_found: 100 + subcode 33. `backoffMs(attempt)` = 60s x 2^(attempt-1), cap 15 min.
- `graph-batch.ts`: `graphBatch(token, reqs: {method, relative_url}[]) -> {ok, status, body|error}[]` — chunks of 50 via `fbPostForm('/', {batch: JSON.stringify(chunk), include_headers: 'false'}, token, PAGE_SCHEDULER_FB_API_BASE)`, parses each `body` string; never throws per item.
- `constants.ts`: `MAX_SCHEDULE_DAYS=29` (FB window, raise after spike), `MAX_UPLOAD_DAYS=35`, `CRON_PUSH_LIMIT=30`, `UPLOAD_MIN_LEAD_MIN=15`, `PUSH_MIN_LEAD_MIN=10`, `MAX_ROWS_PER_UPLOAD=1000`, `MAX_MESSAGE_CHARS=63206`, `IMAGE_MAX_BYTES=4MB`, `PNG_MAX_BYTES=1MB`, `IMAGE_EXTS=['jpg','jpeg','png','gif']`, `MEDIA_BUCKET='page-scheduler-media'`, `DEFAULT_COUNTRIES=['US','GB','CA','AU','NZ','IE','DE','FR','NL','SE','NO','DK','FI']`, `METRIC_NAMES` (from spike), `REQUIRED_SCOPES`, `OPTIONAL_SCOPES=['read_insights']`, `SCHEDULE_TZ_OFFSET='+07:00'`.

## Related Code Files
- Modify: `supabase/schema.sql` (append only), `lib/facebook/fb-client.ts` (additive)
- Create: `lib/page-scheduler/types.ts`, `lib/page-scheduler/constants.ts`, `lib/page-scheduler/graph-errors.ts`, `lib/page-scheduler/graph-batch.ts`
- Delete: none

## Implementation Steps
1. Append SQL block (tables, indexes, RPC, revoke) with header comment "apply manually in Supabase SQL editor".
2. Extend `fb-client.ts`: constant, `FbApiError`, DELETE, `fbDelete`. Keep `FB_API_BASE` default untouched.
3. Write `types.ts` (`PsProfile` (no token fields; includes `expires_at`), `PsPage` (no token), `PsBatch`, `PsPost`, `PsPostStatus`, `PsRowInput`, `PsRowIssue {row, field, level:'error'|'warning', message}`).
4. Write `constants.ts` with Phase 00 values (placeholders + TODO if spike not yet done).
5. Write `graph-errors.ts`, `graph-batch.ts` (each <80 lines).
6. `npx tsc --noEmit`, `npm run lint`, `npm run build`.

## Todo List
- [x] SQL appended to schema.sql L291-432 (user to apply manually, twice to prove idempotent)
- [ ] Bucket `page-scheduler-media` created (private, no policies)
- [x] fb-client additive changes
- [x] types / constants / graph-errors / graph-batch
- [x] typecheck + eslint + build pass

## Success Criteria
- `pg_policies`: 0 rows for `ps_fb_profiles`, `ps_pages`; 1 own-row policy each for the other 3; anon cannot `rpc('ps_claim_posts')`.
- `grep -rn "FB_API_BASE\|AFS_FB_API_BASE"` shows no existing call site changed.
- Scratch script: `classifyFbError` maps sample errors correctly; `graphBatch` parses a mocked mixed response.

## Risk Assessment
| Risk | L x I | Mitigation |
|---|---|---|
| `FbApiError` change alters existing error text | L x M | Same message string; only adds props; build + smoke Dashboard |
| RPC callable by browser | L x H | `revoke execute` + security definer; service client only |
| Slot unique index blocks legit retry after re-upload | L x L | Surface "slot already used" error on retry |

## Security Considerations
- Token tables unreadable by anon/authenticated (no policies). Types for API responses exclude `*_enc` fields by construction.
- Encryption key `AFS_TOKEN_ENCRYPTION_KEY` reused (same AES-GCM envelope, AAD = user_id).

## Next Steps
- Phase 02 consumes tables + `PAGE_SCHEDULER_FB_API_BASE`.

## Sync-back deltas (2026-10-11)
- `ps_claim_posts` gained 7th arg `p_idle_minutes int default 0` (cron sweep of idle `queued` rows); also skips rows in `next_attempt_at` backoff. Revoke updated to 7-arg signature.
- `PUSH_MIN_LEAD_MIN` = 12 (was 10). `QUEUED_IDLE_MIN`/`CRON_QUEUED_LIMIT` added. Reconcile/metrics/cron budget constants added.
- Extra modules beyond spec: `graph-errors` backoff, `push-outcome`, `push-payload`, `batch-queries`, `upload-file-rules`, `row-validation-warnings`, `reconcile-decision`, `metrics-parse`, `analytics-aggregate`, `queued-sweep`, `batch-finalize`, `cron-page-access`.
