# Facebook Page Scheduler: Setup and Operations

Tool at `/page-scheduler` (Tool Hub card). Bulk-schedules posts to many Facebook Pages from CSV/JSON using Facebook native scheduling (Graph API v26.0). Visibility follows the FB dashboard; only the row owner can mutate.

## One-Time Setup

| # | Step | Where |
|---|------|-------|
| 1 | Apply `supabase/schema.sql` lines 291-442 (Page Scheduler block, idempotent) | Supabase SQL editor |
| 2 | Create a **private** bucket `page-scheduler-media`: file size limit **4 MB**, allowed MIME types `image/jpeg,image/png,image/gif`, no policies | Supabase Storage |
| 3 | Set `CRON_SECRET` (random 32+ chars) | Vercel project env vars |
| 4 | Optional: set `FB_APP_ID` and `FB_APP_SECRET` | Vercel project env vars |
| 5 | Deploy so Vercel registers the new cron | Vercel |

Signed upload URLs do not enforce the bucket limits; the bucket does. The app also enforces its own limits (see [Limits](#limits)).

## Meta Prerequisites

- **System User token (recommended):** in Business Manager, assign each Page to the System User as an asset. Grant **Content** and **Insights** tasks. Grant **Full control** on Pages whose profile picture will be changed.
- **Personal USER tokens:** the user must hold an app role on the Meta app.
- `FB_APP_ID` and `FB_APP_SECRET` are optional. Without them, tokens are stored as pasted. With them, USER tokens are exchanged to long-lived (~60 days) and checked with `debug_token`.
- Required token scopes: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`. `read_insights` is optional (analytics degrade without it).

## Upload Files

Templates: `public/templates/page-scheduler-template.csv` and `public/templates/page-scheduler-template.json` (served at `/templates/...`).

| Column | Format | Notes |
|--------|--------|-------|
| `scheduled_at` | `2026-10-15 09:30` or ISO 8601 with offset | Naive times are read as Bangkok time (UTC+7) |
| `page_id` | Numeric Page ID | Must be a Page the bound profile can manage |
| `message` | Text | Multi-line allowed in quoted CSV cells |
| `image` | Empty, `https://` URL, or a local file chosen in the upload UI | Optional |
| `countries` | `US\|GB` (pipe-separated ISO codes) or `ALL` | Empty uses the per-user default list |

Validation runs in the browser, then again on the server against the database (Page ownership, duplicate slots).

## Scheduling Flow

| Scheduled time | Behavior |
|----------------|----------|
| Within 29 days | Pushed by the browser loop to Facebook as a scheduled post |
| 29 to 35 days ahead | Stored as `waiting`; the hourly cron pushes it once it enters the window |
| Less than 15 min ahead at upload | Rejected |

## Cron

`/api/cron/page-scheduler-sync` runs hourly at `:15` (`vercel.json`). It authenticates with `Authorization: Bearer $CRON_SECRET`. Each run:

- pushes up to 30 `waiting` rows that entered the window;
- pushes `queued` rows idle for more than 30 min (abandoned browser loop);
- reconciles `scheduled` posts with Facebook and refreshes engagement metrics.

## Limits

| Item | Value |
|------|-------|
| Upload horizon | 35 days ahead |
| Facebook native window | 29 days (provisional, pending live API spike) |
| Rows per upload | 1000 |
| Image size | JPEG/GIF 4 MB; PNG 1 MB (app-enforced, use JPEG for larger) |
| Message length | 63,206 characters |
| Minimum lead time | 15 min at upload; 12 min at push |
| Page-level country restriction | Not available via the Graph API; out of scope |
| Cancel | Best-effort `DELETE` on the Facebook post; failures are shown in the UI |
| Uncertain push errors | Marked failed with "Uncertain push outcome" to avoid duplicates; check Business Suite before retrying |

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Cron returns 500 `CRON_SECRET not configured` | Set `CRON_SECRET` in Vercel and redeploy |
| Upload fails on image | Confirm bucket limits and the app's JPEG/GIF 4 MB and PNG 1 MB caps |
| Token marked `invalid` | Facebook error code 190; re-paste the token |
| Post shows "Uncertain push outcome" | Verify in Business Suite before retrying to avoid a duplicate |
