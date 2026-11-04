/**
 * POST /api/tiktok/ad-map  { ad_ids: string[], advertiser_ids: string[], viewAs?: string }
 * Maps AppsFlyer ad ids to TikTok { campaign_id, adset_id (= adgroup_id) } so the dashboard can
 * attach ad-level revenue to campaigns/ad groups. Target = viewAs (must pass canViewAs) or the
 * requester, same as GET /api/tiktok/campaigns. Only advertisers that are among the target's
 * selected tiktok_ad_accounts are queried; any others in the request are ignored.
 * getValidAccessToken(target) is called once and reused; the token never leaves the server.
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { canViewAs } from '@/lib/auth-guards';
import { getValidAccessToken, describeAuthError } from '@/lib/tiktok/tiktok-connection';
import { fetchAdPlacements } from '@/lib/tiktok/ad-placements';

// Advertisers × ID chunks are queried against TikTok; allow more than the platform default.
export const maxDuration = 60;

const MAX_AD_IDS = 5000;
const MAX_ADVERTISERS = 500;
const NUMERIC_ID = /^\d{1,24}$/;

/** Deduped list of numeric-string ids, or null when the value is not a valid bounded list. */
function parseIdList(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  if (!value.every((v) => typeof v === 'string' && NUMERIC_ID.test(v))) return null;
  return [...new Set(value as string[])];
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const adIds = parseIdList(body.ad_ids, MAX_AD_IDS);
  if (!adIds) return errorResponse(`ad_ids must be an array of at most ${MAX_AD_IDS} numeric strings`, 400);
  const advertiserIds = parseIdList(body.advertiser_ids, MAX_ADVERTISERS);
  if (!advertiserIds) return errorResponse(`advertiser_ids must be an array of at most ${MAX_ADVERTISERS} numeric strings`, 400);
  if (body.viewAs !== undefined && typeof body.viewAs !== 'string') return errorResponse('viewAs must be a string', 400);

  // viewAs: leader/admin map ads on another user's accounts with THAT user's token (read-only).
  const viewAs = body.viewAs as string | undefined;
  const isViewAs = !!viewAs && viewAs !== user.id;
  const target = isViewAs ? viewAs : user.id;
  if (isViewAs) {
    const denied = await canViewAs(user.id, target);
    if (denied) return denied;
  }

  if (adIds.length === 0 || advertiserIds.length === 0) return Response.json({ placements: {} });

  const service = createServiceClient();
  const { data, error: dbError } = await service
    .from('tiktok_ad_accounts')
    .select('advertiser_id')
    .eq('user_id', target)
    .eq('is_selected', true)
    .in('advertiser_id', advertiserIds);
  if (dbError) return errorResponse('Failed to load TikTok advertiser accounts', 500);
  const allowed = (data ?? []).map((a) => String((a as { advertiser_id: string }).advertiser_id));
  if (allowed.length === 0) return Response.json({ placements: {} });

  let token: string;
  try {
    token = await getValidAccessToken(target);
  } catch (err) {
    const { status, message } = describeAuthError(err);
    return errorResponse(message, status);
  }

  try {
    const placements = await fetchAdPlacements(token, allowed, adIds);
    return Response.json({ placements });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to map TikTok ads';
    return errorResponse(message, 502);
  }
}
