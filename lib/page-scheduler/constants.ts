/**
 * Page Scheduler constants. Values marked [spike] are provisional until Phase 00 live-API
 * results are recorded (plans/261010-2246-facebook-page-scheduler/phase-00-live-api-spike.md).
 */

/** FB native scheduling window in days [spike: may be raised to ~75]. */
export const MAX_SCHEDULE_DAYS = 29;
/** Upload accepts rows up to this far ahead; rows beyond MAX_SCHEDULE_DAYS wait for cron. */
export const MAX_UPLOAD_DAYS = 35;
/** Max deferred ('waiting') rows pushed per cron run. */
export const CRON_PUSH_LIMIT = 30;
/** Minimum lead time (minutes) between now and scheduled_at at upload / at push. */
export const UPLOAD_MIN_LEAD_MIN = 15;
/** Claim cutoff at push time (> FB's 10-min minimum, leaves margin for push latency). */
export const PUSH_MIN_LEAD_MIN = 12;
/** Cron also pushes 'queued' rows left untouched this long (browser loop abandoned); max per run. */
export const QUEUED_IDLE_MIN = 30;
export const CRON_QUEUED_LIMIT = 30;

export const MAX_ROWS_PER_UPLOAD = 1000;
export const MAX_MESSAGE_CHARS = 63206;
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const PNG_MAX_BYTES = 1 * 1024 * 1024;
export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif'] as const;

/** Private Supabase Storage bucket (no policies; service client + signed upload URLs only). */
export const MEDIA_BUCKET = 'page-scheduler-media';

export const DEFAULT_COUNTRIES = [
  'US', 'GB', 'CA', 'AU', 'NZ', 'IE', 'DE', 'FR', 'NL', 'SE', 'NO', 'DK', 'FI',
] as const;

/** Post insight metrics on v26 [spike: confirm]. Maps to views / unique_views / clicks. */
export const METRIC_NAMES = {
  views: 'post_media_view',
  uniqueViews: 'post_total_media_view_unique',
  clicks: 'post_clicks',
} as const;

/** Hard-required token scopes; binding is rejected if any is missing. */
export const REQUIRED_SCOPES = ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement'] as const;
/** Missing optional scopes only produce a warning (analytics degraded). */
export const OPTIONAL_SCOPES = ['read_insights'] as const;

/** Upload times in files are interpreted in this offset (UTC+7). */
export const SCHEDULE_TZ_OFFSET = '+07:00';

/** Graph batch endpoint hard limit per request. */
export const GRAPH_BATCH_MAX = 50;

/** Cron reconcile / metrics tuning. */
export const RECONCILE_GRACE_MIN = 15;
/** A `scheduled` post still unpublished this long after its time is failed. */
export const UNPUBLISHED_FAIL_HOURS = 2;
/** A `pushing` row older than this is considered stuck (cron adopts or fails it). */
export const STALE_PUSHING_MIN = 15;
/** Rows of a token-less Page older than this are failed instead of silently skipped forever. */
export const DISCONNECTED_FAIL_HOURS = 6;
export const METRICS_WINDOW_DAYS = 14;
export const METRICS_REFRESH_HOURS = 6;
/** Posts refreshed per cron run (2 batch sub-requests each); leftovers roll to the next run. */
export const METRICS_MAX_POSTS_PER_RUN = 300;
export const RECONCILE_MAX_POSTS_PER_RUN = 300;
/** Cron wall-clock budget (ms); route maxDuration is 60 s. */
export const CRON_BUDGET_MS = 50_000;
