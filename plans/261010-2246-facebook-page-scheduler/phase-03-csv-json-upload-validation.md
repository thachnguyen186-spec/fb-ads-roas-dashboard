# Phase 03 — Templates, parse/validate, image upload, batch create

## Context Links
- `lib/adjust/csv-parser.ts` (papaparse usage; dep already installed) · `lib/afs/storage.ts` (bucket + sign pattern)
- `lib/adjust/api-client.ts` (Bangkok `+07:00` convention) · Phase 01 constants/types · Phase 02 `ps_pages`

## Overview
- Priority: P1 · Status: Implemented — pending live verification (1000-row/50-image upload, finalize 409) · Effort: 6h · Depends: 02 · Blocks: 04
- User downloads template, fills it, uploads CSV/JSON + image files; sees per-row errors/warnings before anything is stored; valid batch -> rows `queued`.

## Key Insights
- Vercel request body cap ~4.5 MB -> images must NOT go through route handlers: browser uploads directly via Supabase `createSignedUploadUrl` + `uploadToSignedUrl` (private bucket, no storage policies needed).
- One pure validator shared by browser (instant preview) and server (authoritative) = DRY. Server adds DB-only checks (page ownership, existing-slot duplicates).
- All-or-nothing batch create: any row error -> 400 with issues; user fixes file. Simpler than partial batches.

## Requirements
### Template columns (`public/templates/page-scheduler-template.csv` + `.json`)
| Column | Req | Format |
|---|---|---|
| `scheduled_at` | yes | `YYYY-MM-DD HH:mm` = Asia/Bangkok, or ISO 8601 with offset/`Z`; up to 35 days ahead |
| `page_id` | yes | numeric FB Page id from Settings > Pages |
| `message` | if no image | text, <=63,206 chars, newlines allowed (quote in CSV) |
| `image` | no | empty, `https://...` public URL, or filename of an uploaded file (case-insensitive) |
| `countries` | no | empty = user default; `US|GB|CA` (pipe/comma/space); `ALL` = no targeting |

CSV example:
```
scheduled_at,page_id,message,image,countries
2026-10-15 09:30,102938475610293,"Morning tip: drink water first thing.",tip1.jpg,
2026-10-15 19:00,102938475610293,Evening recap,https://cdn.example.com/recap.png,US|GB
2026-10-16 08:00,564738291056473,Text-only post,,ALL
```
JSON: array of objects with same keys; `countries` may be string or string[].

### Validation rules (`row-validation.ts`, pure)
Errors: missing required header; >1000 rows; unparseable time; time < now+15 min or > now+`MAX_UPLOAD_DAYS` (35); `page_id` not in user's active pages or page lacks `CREATE_CONTENT`; empty message and no image; message too long; image URL not `https:`/invalid; image filename not in uploaded set; extension not jpg/jpeg/png/gif; file >4 MB (png >1 MB); unknown country code / >25 codes; duplicate (page_id, scheduled_at) within file; (server) slot already used by an existing non-cancelled/failed post.
Warnings: rows > now+`MAX_SCHEDULE_DAYS` (info: "will wait, auto-pushed hourly once within Facebook's window"); same message on >=3 pages within 24h (spam risk); >3 posts per page per day; two posts on same page <30 min apart; unknown extra columns; uploaded files not referenced.

## Architecture
```
Browser: file-parse.ts (papaparse | JSON.parse) -> normalize rows -> validateRows(rows, ctx{pages, fileManifest, now, defaults})
         -> preview table (errors block "Create batch")
POST /api/page-scheduler/batches {file_name, source_type, rows[], files:[{name,size,type}]}
  server: re-run validateRows with DB ctx + slot-dup query -> 400 {issues} | insert ps_batches(status awaiting_media|ready)
          + ps_posts(status draft if upload images, else queued; countries resolved; image_ref = path ps/{user}/{batch}/{safeName})
          -> createSignedUploadUrl per referenced file -> {batch_id, uploads:[{name, path, token}]}
Browser: supabase.storage.from(bucket).uploadToSignedUrl(path, token, file) (concurrency 4, progress bar)
POST /api/page-scheduler/batches/{id}/finalize -> list ps/{user}/{batch}/ objects -> every referenced path exists + metadata size/mimetype ok
  -> posts draft->queued (beyond-window rows parked as `waiting` by first push step), batch ready | 409 {missing:[...]} (client may retry upload of missing)
```
Time parsing (`schedule-time.ts`): regex `^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$` -> append `+07:00`; else require explicit offset; reject other formats (no `Date` guessing). Display back in Bangkok time.
Filename sanitisation: lowercase, `[^a-z0-9._-]` -> `_`, collision within batch -> error.

## Related Code Files
- Create: `public/templates/page-scheduler-template.csv`, `public/templates/page-scheduler-template.json`, `lib/page-scheduler/schedule-time.ts`, `lib/page-scheduler/file-parse.ts`, `lib/page-scheduler/row-validation.ts` (split `row-validation-warnings.ts` if >200 lines), `lib/page-scheduler/media-storage.ts` (signed upload URLs, verify batch files, download for push, sign URL), `lib/page-scheduler/batch-create.ts`, `app/api/page-scheduler/batches/route.ts` (GET list w/ status counts for visible users via `resolveOwnerFilter`, POST create own), `app/api/page-scheduler/batches/[batchId]/finalize/route.ts`, `app/page-scheduler/components/upload-tab.tsx`, `app/page-scheduler/components/upload-preview-table.tsx`
- Modify: `app/page-scheduler/components/page-scheduler-hub.tsx` (mount Upload tab)
- Delete: none

## Implementation Steps
1. Templates (3 example rows each) + download links in Upload tab.
2. `schedule-time.ts`, `file-parse.ts` (no `@/` server imports — must run in browser).
3. `row-validation.ts` returning `{rows: PsRowInput[], issues: PsRowIssue[]}` with resolved `scheduledAt`, `countries`, `imageKind`.
4. `media-storage.ts` (service client; bucket from constants).
5. `batch-create.ts`: load user's active pages (non-secret columns), slot-dup query over the file's (page_id, scheduled_at) set, insert batch + posts in one insert call (<=1000 rows), on unique-violation map to issue.
6. Routes; finalize is idempotent (re-callable).
7. UI: drop zone for data file + multi-image picker, preview table (row #, time Bangkok, page name, message snippet, image thumb/name, countries, issues), summary counts, "Create batch" -> upload progress -> finalize -> switch to Queue tab. Payload >4 MB -> client error "split file".
8. Scratch node script for parser/validator edge cases; typecheck/lint/build.

## Todo List
- [x] templates
- [x] schedule-time / file-parse / row-validation
- [x] media-storage / batch-create
- [x] batches + finalize routes
- [x] upload tab + preview table
- [x] scratch validation script

## Success Criteria
- Template file uploads clean with zero edits except dates/page ids.
- Each listed error rule produces a row-level message (scratch script asserts all).
- 1000-row CSV + 50 images (each <4 MB) -> batch `ready` without any request >4.5 MB.
- Same CSV uploaded twice -> second attempt rejected with slot-duplicate errors.

## Risk Assessment
| Risk | L x I | Mitigation |
|---|---|---|
| Excel saves CSV in ANSI / reformats dates | H x M | Accept UTF-8 BOM; explicit format error naming expected pattern; JSON alternative |
| Upload abandoned mid-way | M x L | Batch stays `awaiting_media`; finalize re-callable; GET list shows it; delete batch allowed (Phase 04) |
| Client validator drift vs server | L x M | Same module both sides |
| Orphaned storage objects | M x L | Accept (small); document manual cleanup |

## Security Considerations
- Server never trusts client validation; `user_id` from session only; storage paths prefixed `ps/{userId}/` and generated server-side (no client-chosen paths).
- No server fetch of user image URLs (FB fetches) -> no SSRF surface.
- Message stored as text; rendered escaped in React.

## Next Steps
- Phase 04 pushes `queued` rows.
