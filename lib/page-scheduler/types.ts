/**
 * Page Scheduler tool types. Mirror the `ps_*` tables in supabase/schema.sql.
 * API-facing types deliberately EXCLUDE ciphertext columns (token_enc / page_token_enc) —
 * tokens must never leave the server.
 */

export type PsTokenType = 'USER' | 'SYSTEM_USER';
export type PsProfileStatus = 'active' | 'invalid';

export interface PsProfile {
  id: string;
  user_id: string;
  fb_user_id: string;
  fb_user_name: string;
  token_type: PsTokenType;
  app_id: string | null;
  /** null = token never expires (debug_token expires_at 0). */
  expires_at: string | null;
  granted_scopes: string[];
  status: PsProfileStatus;
  last_error: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PsPage {
  id: string;
  user_id: string;
  profile_id: string;
  page_id: string;
  name: string;
  category: string | null;
  picture_url: string | null;
  tasks: string[];
  is_active: boolean;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PsSettings {
  user_id: string;
  default_countries: string[];
  updated_at: string;
}

export type PsBatchStatus = 'awaiting_media' | 'ready';
export type PsSourceType = 'csv' | 'json';

export interface PsBatch {
  id: string;
  user_id: string;
  file_name: string;
  source_type: PsSourceType;
  status: PsBatchStatus;
  row_count: number;
  created_at: string;
  updated_at: string;
}

/** `waiting` = approved but beyond the FB scheduling window; cron pushes it once in window. */
export type PsPostStatus =
  | 'draft'
  | 'queued'
  | 'waiting'
  | 'pushing'
  | 'scheduled'
  | 'published'
  | 'failed'
  | 'cancelled';

export type PsImageKind = 'none' | 'url' | 'upload';

export interface PsPost {
  id: string;
  batch_id: string;
  user_id: string;
  row_number: number;
  page_id: string;
  page_name: string;
  scheduled_at: string;
  message: string;
  image_kind: PsImageKind;
  /** https URL (kind 'url') or storage path (kind 'upload'). */
  image_ref: string | null;
  /** ISO-3166 alpha-2; empty = no geo targeting. */
  countries: string[];
  status: PsPostStatus;
  attempts: number;
  claimed_at: string | null;
  fb_post_id: string | null;
  fb_photo_id: string | null;
  permalink_url: string | null;
  error: string | null;
  error_code: number | null;
  pushed_at: string | null;
  published_at: string | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  unique_views: number | null;
  clicks: number | null;
  /** DB-generated: reactions + comments + shares. */
  engagement: number;
  metrics_at: string | null;
  metrics_error: string | null;
  created_at: string;
  updated_at: string;
}

/** One parsed + normalised upload row (CSV or JSON) before it becomes a ps_posts row. */
export interface PsRowInput {
  row: number;
  page_id: string;
  /** ISO timestamp (UTC) resolved from the file's local time. */
  scheduled_at: string;
  message: string;
  image: string | null;
  countries: string[] | null;
}

export interface PsRowIssue {
  row: number;
  field: string;
  level: 'error' | 'warning';
  message: string;
}

/** Result of one Graph batch sub-request; never throws per item. */
export interface GraphBatchItem {
  ok: boolean;
  status: number;
  body?: unknown;
  error?: { message: string; code?: number; subcode?: number };
}

export interface GraphBatchRequest {
  method: 'GET' | 'POST' | 'DELETE';
  relative_url: string;
}

export type FbErrorClass =
  | 'transient'
  | 'auth'
  | 'blocked'
  | 'permission'
  | 'not_found'
  | 'invalid'
  | 'unknown';
