/**
 * Per-post owner actions: cancel / retry / edit. Local-only for unpushed rows; scheduled rows
 * are cancelled with a Graph DELETE (FB may refuse -> row stays `scheduled`, message returned).
 * All updates are status-guarded so they cannot race the push claim.
 */

import { PAGE_SCHEDULER_FB_API_BASE, fbDelete } from '@/lib/facebook/fb-client';
import { createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { assertOwner, type PsContext } from './access';
import { MAX_MESSAGE_CHARS, MAX_SCHEDULE_DAYS, MAX_UPLOAD_DAYS, UPLOAD_MIN_LEAD_MIN } from './constants';
import { getPageToken } from './fb-profiles';
import { classifyFbError } from './graph-errors';
import { resolveCountries } from './row-validation';
import { parseScheduleTime } from './schedule-time';
import type { PsPost } from './types';

export const BUSINESS_SUITE_URL = 'https://business.facebook.com/latest/posts/scheduled_posts';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNPUSHED = ['draft', 'queued', 'waiting', 'failed'];
const EDITABLE = ['queued', 'waiting', 'failed'];

export type ActionResult = { ok: true; status: string; note?: string } | { ok: false; httpStatus: number; error: string; link?: string };
const bad = (httpStatus: number, error: string, link?: string): ActionResult => ({ ok: false, httpStatus, error, link });

/** Loads a post by id and enforces owner-only mutation. */
export async function loadOwnedPost(ctx: PsContext, postId: string): Promise<PsPost | Response> {
  if (!UUID_RE.test(postId)) return errorResponse('Invalid post id', 400);
  const { data, error } = await createServiceClient().from('ps_posts').select('*').eq('id', postId).maybeSingle();
  if (error) return errorResponse(error.message, 500);
  if (!data) return errorResponse('Post not found', 404);
  // Hide existence of rows outside the caller's visibility.
  if (!ctx.visibleUserIds.includes((data as PsPost).user_id)) return errorResponse('Post not found', 404);
  return assertOwner(ctx, data as PsPost) ?? (data as PsPost);
}

const nowIso = () => new Date().toISOString();
const statusForTime = (iso: string) => (Date.parse(iso) > Date.now() + MAX_SCHEDULE_DAYS * 86_400_000 ? 'waiting' : 'queued');

async function guardedUpdate(post: PsPost, from: string[], patch: Record<string, unknown>): Promise<ActionResult | null> {
  const { data, error } = await createServiceClient().from('ps_posts')
    .update({ ...patch, updated_at: nowIso() }).eq('id', post.id).in('status', from).select('id');
  if (error) {
    if (error.code === '23505') return bad(409, 'Another active post already uses this Page and time slot');
    throw new Error(error.message);
  }
  return data && data.length > 0 ? null : bad(409, 'Post changed state (it may have just been pushed) — refresh and retry');
}

export async function cancelPost(post: PsPost): Promise<ActionResult> {
  if (UNPUSHED.includes(post.status)) {
    return (await guardedUpdate(post, UNPUSHED, { status: 'cancelled' })) ?? { ok: true, status: 'cancelled' };
  }
  if (post.status !== 'scheduled' || !post.fb_post_id) return bad(409, `A ${post.status} post cannot be cancelled`);
  // Reconcile lags up to ~75 min: past its time the post is probably LIVE, and DELETE would remove it.
  if (Date.parse(post.scheduled_at) <= Date.now() + 60_000) {
    return bad(409, 'Scheduled time has passed — the post may already be live. Manage it in Meta Business Suite.', BUSINESS_SUITE_URL);
  }

  try {
    const token = await getPageToken(post.user_id, post.page_id);
    await fbDelete(`/${post.fb_post_id}`, token, PAGE_SCHEDULER_FB_API_BASE);
  } catch (err) {
    // Already gone on Facebook (deleted elsewhere) counts as cancelled.
    if (classifyFbError(err) !== 'not_found') {
      const reason = err instanceof Error ? err.message : 'unknown error';
      return bad(409, `Facebook refused the cancel (${reason}). Delete it in Meta Business Suite.`, BUSINESS_SUITE_URL);
    }
  }
  return (await guardedUpdate(post, ['scheduled'], { status: 'cancelled' })) ?? { ok: true, status: 'cancelled' };
}

/** Rows failed by the reconcile job as "uncertain" may already exist on FB: need confirmation. */
const isUncertain = (p: PsPost) => /uncertain/i.test(p.error ?? '');

export async function retryPost(post: PsPost, confirmUncertain: boolean): Promise<ActionResult> {
  if (post.status !== 'failed' || post.fb_post_id) return bad(409, 'Only failed posts that never reached Facebook can be retried');
  if (isUncertain(post) && !confirmUncertain) {
    return bad(409, 'This post may already exist on Facebook. Check Meta Business Suite first, then confirm the retry.', BUSINESS_SUITE_URL);
  }
  if (Date.parse(post.scheduled_at) < Date.now() + UPLOAD_MIN_LEAD_MIN * 60_000) {
    return bad(409, 'Schedule time has passed or is too close — edit the time first');
  }
  const status = statusForTime(post.scheduled_at);
  return (await guardedUpdate(post, ['failed'], { status, attempts: 0, error: null, error_code: null, claimed_at: null, next_attempt_at: null }))
    ?? { ok: true, status };
}

export interface EditInput { message?: unknown; scheduled_at?: unknown; countries?: unknown }

export async function editPost(post: PsPost, input: EditInput): Promise<ActionResult> {
  if (!EDITABLE.includes(post.status)) return bad(409, `A ${post.status} post cannot be edited`);
  const patch: Record<string, unknown> = {};

  if (input.message !== undefined) {
    if (typeof input.message !== 'string') return bad(400, 'message must be a string');
    const message = input.message.replace(/\r\n/g, '\n').trim();
    if (message.length > MAX_MESSAGE_CHARS) return bad(400, `Message is ${message.length} chars — max ${MAX_MESSAGE_CHARS}`);
    if (!message && post.image_kind === 'none') return bad(400, 'A text-only post needs a message');
    patch.message = message;
  }
  if (input.scheduled_at !== undefined) {
    if (typeof input.scheduled_at !== 'string') return bad(400, 'scheduled_at must be a string');
    const t = parseScheduleTime(input.scheduled_at);
    if (!t.ok) return bad(400, t.error);
    const now = Date.now();
    if (t.ms < now + UPLOAD_MIN_LEAD_MIN * 60_000) return bad(400, `Must be at least ${UPLOAD_MIN_LEAD_MIN} minutes from now`);
    if (t.ms > now + MAX_UPLOAD_DAYS * 86_400_000) return bad(400, `More than ${MAX_UPLOAD_DAYS} days ahead — not allowed`);
    patch.scheduled_at = t.iso;
    if (post.status !== 'failed') patch.status = statusForTime(t.iso);
  }
  if (input.countries !== undefined) {
    if (!Array.isArray(input.countries) || input.countries.some((c) => typeof c !== 'string')) return bad(400, 'countries must be an array of ISO codes');
    const c = resolveCountries(input.countries.length ? (input.countries as string[]).join(',') : 'ALL', []);
    if (c.error) return bad(400, c.error);
    patch.countries = c.countries;
  }
  if (Object.keys(patch).length === 0) return bad(400, 'Nothing to update');
  patch.next_attempt_at = null;

  return (await guardedUpdate(post, EDITABLE, patch)) ?? { ok: true, status: (patch.status as string) ?? post.status };
}

/** Maps an ActionResult to a Response. */
export function actionResponse(r: ActionResult): Response {
  if (r.ok) return Response.json(r);
  return Response.json({ error: r.error, link: r.link }, { status: r.httpStatus });
}
