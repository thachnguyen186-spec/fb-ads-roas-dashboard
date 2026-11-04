/**
 * POST /api/campaigns/ad-map
 * Body: { ad_ids: string[], viewAs?: string }
 * Returns: { placements: Record<ad_id, { campaign_id, adset_id }>, warnings: string[] }
 *
 * Maps AppsFlyer ad IDs to FB campaign + ad set across the target user's selected ad accounts,
 * so per-ad AppsFlyer revenue can be rolled up onto the campaign dashboard. IDs that are not FB
 * ads (TikTok, other networks) simply come back unmapped.
 *
 * viewAs: leader/admin may map against a staff user's accounts using that user's token
 * (same rule as GET /api/campaigns). The token never leaves the server.
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { canViewAs } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';
import { fetchAdPlacements } from '@/lib/facebook/ad-placements';

// Accounts × ID chunks are queried against Graph; allow more than the platform default.
export const maxDuration = 60;

const MAX_AD_IDS = 5000;
const AD_ID_RE = /^\d{1,25}$/;

type ParsedBody = { adIds: string[]; viewAs: string | null };

function parseBody(body: unknown): ParsedBody | string {
  if (typeof body !== 'object' || body === null) return 'Body must be a JSON object';
  const { ad_ids, viewAs } = body as { ad_ids?: unknown; viewAs?: unknown };
  if (!Array.isArray(ad_ids)) return 'ad_ids must be an array of ad ID strings';
  // Cap first so an oversized body is rejected before any per-item work.
  if (ad_ids.length > MAX_AD_IDS) return `Too many ad IDs (${ad_ids.length}); the limit is ${MAX_AD_IDS}`;
  if (!ad_ids.every((id): id is string => typeof id === 'string' && AD_ID_RE.test(id))) {
    return 'ad_ids must contain numeric ID strings only';
  }
  const adIds = [...new Set(ad_ids)];
  if (viewAs !== undefined && viewAs !== null && (typeof viewAs !== 'string' || !viewAs)) {
    return 'viewAs must be a user ID string';
  }
  return { adIds, viewAs: (viewAs as string | null | undefined) ?? null };
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  const parsed = parseBody(raw);
  if (typeof parsed === 'string') return errorResponse(parsed, 400);
  const { adIds, viewAs } = parsed;

  const targetUserId = viewAs ?? user.id;
  if (viewAs && viewAs !== user.id) {
    const denied = await canViewAs(user.id, viewAs);
    if (denied) return denied;
  }

  if (adIds.length === 0) return Response.json({ placements: {}, warnings: [] });

  const service = createServiceClient();
  const [profileRes, accountsRes] = await Promise.all([
    service.from('profiles').select('fb_access_token').eq('id', targetUserId).single(),
    service
      .from('fb_ad_accounts')
      .select('account_id, name')
      .eq('user_id', targetUserId)
      .eq('is_selected', true),
  ]);

  if (!profileRes.data) return errorResponse('Profile not found', 404);
  const { fb_access_token } = profileRes.data as { fb_access_token: string | null };
  if (!fb_access_token) return errorResponse('Facebook access token not configured.', 400);
  if (accountsRes.error) return errorResponse('Failed to load ad accounts', 500);

  const accounts = (accountsRes.data ?? []) as { account_id: string; name: string }[];
  if (accounts.length === 0) return errorResponse('No ad accounts selected. Go to Settings.', 400);

  try {
    const result = await fetchAdPlacements(fb_access_token, accounts, adIds);
    return Response.json(result);
  } catch (err) {
    // fetchAdPlacements isolates per-account errors; reaching here means an unexpected failure.
    return errorResponse(err instanceof Error ? err.message : 'Failed to map ads to campaigns', 502);
  }
}
