/**
 * GET/PATCH /api/afs-niche-testing/topics/{topicId}
 * GET returns one topic + its creatives (signed URLs) plus a derived daily_budget_major for display.
 * PATCH accepts an explicit client-editable field whitelist; the client sends `daily_budget_major`
 * (a decimal), never `daily_budget_minor` — this route is the single authoritative conversion point
 * (same rule as lib/facebook/campaign-actions.ts:145: VND has no sub-unit, ×100 otherwise), then
 * hard-caps against AFS_MAX_DAILY_BUDGET_MINOR regardless of what the review UI showed. `status`,
 * `fb_campaign_id`, `fb_adset_id`, `user_id` are never accepted from the body. admin|leader only,
 * and only for topics the caller owns.
 */
import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';
import { signUrl } from '@/lib/afs/storage';
import type { AfsCreative, AfsTopic, SpecialAdCategory } from '@/lib/types';

type Params = { params: Promise<{ topicId: string }> };

const LOCKED_STATUSES = new Set(['publishing', 'published']);
const SPECIAL_AD_CATEGORIES: SpecialAdCategory[] = ['NONE', 'EMPLOYMENT', 'HOUSING', 'CREDIT', 'ISSUES_ELECTIONS_POLITICS'];
const FALLBACK_BUDGET_CEILING_MINOR = 500_000; // matches .env.local.example's documented default; used only if the env var is unset/invalid

function toMinor(major: number, currency: string): number {
  return currency === 'VND' ? Math.round(major) : Math.round(major * 100);
}

function toMajor(minor: number, currency: string): number {
  return currency === 'VND' ? minor : Math.round(minor) / 100;
}

async function loadOwnedTopic(userId: string, topicId: string): Promise<{ topic: AfsTopic } | { errorRes: Response }> {
  const service = createServiceClient();
  const { data, error } = await service.from('afs_topics').select('*').eq('id', topicId).maybeSingle();
  if (error) return { errorRes: errorResponse(error.message, 500) };
  if (!data) return { errorRes: errorResponse('Topic not found', 404) };
  const topic = data as AfsTopic;
  if (topic.user_id !== userId) return { errorRes: errorResponse('Forbidden — not your topic', 403) };
  return { topic };
}

/** Looks up the topic's ad account currency for display-only major-unit conversion. Defaults to USD. */
async function lookupCurrency(userId: string, adAccountId: string | null): Promise<string> {
  if (!adAccountId) return 'USD';
  const service = createServiceClient();
  const { data } = await service
    .from('fb_ad_accounts')
    .select('currency')
    .eq('account_id', adAccountId)
    .eq('user_id', userId)
    .maybeSingle();
  return (data as { currency?: string } | null)?.currency || 'USD';
}

export async function GET(_request: Request, { params }: Params) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin', 'leader']);
  if (denied) return denied;

  const { topicId } = await params;
  const loaded = await loadOwnedTopic(user.id, topicId);
  if ('errorRes' in loaded) return loaded.errorRes;
  const { topic } = loaded;

  const service = createServiceClient();
  const currency = await lookupCurrency(user.id, topic.ad_account_id);

  const { data: creativesRaw, error: creativesError } = await service
    .from('afs_creatives')
    .select('*')
    .eq('topic_id', topicId);
  if (creativesError) return errorResponse(creativesError.message, 500);

  const creatives = await Promise.all(
    ((creativesRaw ?? []) as AfsCreative[]).map(async (creative) => {
      if (creative.status !== 'succeeded' || !creative.storage_path) return { ...creative, signed_url: null };
      try {
        return { ...creative, signed_url: await signUrl(creative.storage_path) };
      } catch (err) {
        return { ...creative, signed_url: null, sign_error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  return Response.json({
    topic: { ...topic, daily_budget_major: toMajor(topic.daily_budget_minor, currency) },
    creatives,
  });
}

interface PatchBody {
  target_url?: unknown;
  primary_text?: unknown;
  ad_headline?: unknown;
  countries?: unknown;
  special_ad_category?: unknown;
  ad_account_id?: unknown;
  page_id?: unknown;
  page_name?: unknown;
  pixel_id?: unknown;
  daily_budget_major?: unknown;
  currency?: unknown;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin', 'leader']);
  if (denied) return denied;

  const { topicId } = await params;
  const loaded = await loadOwnedTopic(user.id, topicId);
  if ('errorRes' in loaded) return loaded.errorRes;
  const { topic } = loaded;

  if (LOCKED_STATUSES.has(topic.status)) {
    return errorResponse(`Topic status "${topic.status}" cannot be edited — publish is already in progress or complete.`, 409);
  }

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const updates: Record<string, unknown> = {};

  if (body.target_url !== undefined) {
    if (typeof body.target_url !== 'string' || !body.target_url.startsWith('https://')) return errorResponse('target_url must start with https://', 400);
    updates.target_url = body.target_url.trim();
  }

  if (body.primary_text !== undefined) {
    if (typeof body.primary_text !== 'string') return errorResponse('primary_text must be a string', 400);
    updates.primary_text = body.primary_text;
  }

  if (body.ad_headline !== undefined) {
    if (typeof body.ad_headline !== 'string') return errorResponse('ad_headline must be a string', 400);
    updates.ad_headline = body.ad_headline;
  }

  if (body.countries !== undefined) {
    if (!Array.isArray(body.countries) || !body.countries.every((c) => typeof c === 'string')) return errorResponse('countries must be an array of strings', 400);
    updates.countries = (body.countries as string[]).map((c) => c.toUpperCase());
  }

  if (body.special_ad_category !== undefined) {
    if (!SPECIAL_AD_CATEGORIES.includes(body.special_ad_category as SpecialAdCategory)) return errorResponse('Invalid special_ad_category', 400);
    updates.special_ad_category = body.special_ad_category;
  }

  // ad_account_id / page_id / page_name / pixel_id share the same "string or null" shape.
  // Once a campaign already exists, these are pinned to the account/page it was created under —
  // changing them here wouldn't touch the live campaign, just desync the DB from reality (e.g. a
  // partial_failed retry that publishes a new ad under an adset that belongs to a different
  // account than the one now stored). Lock them as soon as fb_campaign_id is set, regardless of
  // status — primary_text/ad_headline/countries/budget/category below stay editable so a
  // partial_failed topic can still be fixed and retried.
  const touchesConnectionFields = (['ad_account_id', 'page_id', 'page_name', 'pixel_id'] as const)
    .some((field) => body[field] !== undefined);
  if (touchesConnectionFields && topic.fb_campaign_id) {
    return errorResponse('Ad account/Page/Pixel cannot be changed once a campaign has been created for this topic.', 409);
  }
  for (const field of ['ad_account_id', 'page_id', 'page_name', 'pixel_id'] as const) {
    const fieldValue = body[field];
    if (fieldValue === undefined) continue;
    if (fieldValue !== null && typeof fieldValue !== 'string') {
      return errorResponse(`${field} must be a string or null`, 400);
    }
    updates[field] = fieldValue;
  }

  if (body.daily_budget_major !== undefined) {
    const major = typeof body.daily_budget_major === 'number' ? body.daily_budget_major : Number(body.daily_budget_major);
    if (!Number.isFinite(major) || major <= 0) return errorResponse('daily_budget_major must be a positive number', 400);
    // Derive currency server-side from the (possibly just-updated) ad account — never trust a
    // client-supplied `currency` string, which could silently under/over-convert by ~100x.
    const accountForCurrency = (updates.ad_account_id as string | null | undefined) ?? topic.ad_account_id;
    const currency = await lookupCurrency(user.id, accountForCurrency);
    const minor = toMinor(major, currency);
    const ceilingRaw = Number(process.env.AFS_MAX_DAILY_BUDGET_MINOR);
    const ceiling = Number.isFinite(ceilingRaw) && ceilingRaw > 0 ? ceilingRaw : FALLBACK_BUDGET_CEILING_MINOR;
    if (minor > ceiling) return errorResponse(`daily_budget_major exceeds the maximum allowed daily budget (${ceiling} minor units)`, 400);
    updates.daily_budget_minor = minor;
  }

  if (Object.keys(updates).length === 0) return errorResponse('No editable fields provided', 400);

  const service = createServiceClient();
  const { data: updated, error: updateError } = await service
    .from('afs_topics')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', topicId)
    .eq('user_id', user.id)
    .select('*')
    .single();
  if (updateError || !updated) return errorResponse(updateError?.message ?? 'Failed to update topic', 500);

  return Response.json({ topic: updated as AfsTopic });
}
