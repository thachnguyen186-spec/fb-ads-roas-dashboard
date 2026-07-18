/**
 * PATCH /api/tiktok/campaigns/[campaignId]
 * Executes pause/enable/budget actions against TikTok's shared org-wide credential.
 * Role-gated admin|leader — unlike FB's per-user token, TikTok control acts on every
 * connected advertiser account, so an authenticated-only gate would let any staff account
 * pause or re-budget the entire org's spend (Phase 4 Red Team Fix #1).
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';
import { getValidAccessToken } from '@/lib/tiktok/tiktok-connection';
import { verifyCampaignOwnership } from '@/lib/tiktok/campaigns';
import { updateCampaignStatus, updateCampaignBudget } from '@/lib/tiktok/campaign-actions';
import { MIN_DAILY_BUDGET_CAMPAIGN } from '@/lib/tiktok/budget-limits';

type Params = { params: Promise<{ campaignId: string }> };

type ActionBody =
  | { action: 'pause'; advertiser_id: string }
  | { action: 'enable'; advertiser_id: string }
  | { action: 'budget'; advertiser_id: string; amount: number };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { campaignId } = await params;

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin', 'leader']);
  if (denied) return denied;

  let body: ActionBody;
  try {
    body = await request.json() as ActionBody;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  if (!body.advertiser_id) return errorResponse('advertiser_id is required', 400);

  const service = createServiceClient();
  const { data: account } = await service
    .from('tiktok_advertiser_accounts')
    .select('advertiser_id')
    .eq('advertiser_id', body.advertiser_id)
    .eq('is_selected', true)
    .maybeSingle();
  if (!account) return errorResponse('Unknown or unselected advertiser_id', 403);

  let token: string;
  try {
    token = await getValidAccessToken();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'TIKTOK_NOT_CONNECTED') return errorResponse('TikTok is not connected.', 400);
    if (message === 'TIKTOK_RECONNECT_REQUIRED') return errorResponse('TikTok connection expired — reconnect in Settings.', 409);
    return errorResponse(message, 502);
  }

  const owned = await verifyCampaignOwnership(token, body.advertiser_id, campaignId).catch(() => null);
  if (!owned) return errorResponse('Campaign does not belong to the supplied advertiser_id', 403);

  try {
    if (body.action === 'pause') {
      await updateCampaignStatus(token, body.advertiser_id, [campaignId], 'DISABLE');
      return Response.json({ success: true });
    }
    if (body.action === 'enable') {
      await updateCampaignStatus(token, body.advertiser_id, [campaignId], 'ENABLE');
      return Response.json({ success: true });
    }
    if (body.action === 'budget') {
      const { amount } = body;
      if (!Number.isFinite(amount) || amount <= 0) return errorResponse('Invalid budget: amount must be > 0', 400);
      // budget_mode comes from the ownership lookup (TikTok's real, stored value), never the
      // client body — LIFETIME minimum is dynamic (daily min × duration), so only DAILY is checked.
      if (owned.budget_mode === 'DAILY' && amount < MIN_DAILY_BUDGET_CAMPAIGN) {
        return errorResponse(`Daily budget must be at least $${MIN_DAILY_BUDGET_CAMPAIGN}`, 400);
      }
      await updateCampaignBudget(token, body.advertiser_id, campaignId, amount);
      return Response.json({ success: true });
    }
    return errorResponse('Unknown action', 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'TikTok API error';
    return errorResponse(message, 502);
  }
}
