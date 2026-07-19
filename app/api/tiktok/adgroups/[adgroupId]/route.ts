/**
 * PATCH /api/tiktok/adgroups/[adgroupId]
 * Same shape as /api/tiktok/campaigns/[campaignId] at ad-group level — role gate, advertiser
 * + ownership validation, DAILY-mode-only budget minimum (Phase 4 Red Team Fixes).
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';
import { getValidAccessToken } from '@/lib/tiktok/tiktok-connection';
import { verifyAdGroupOwnership } from '@/lib/tiktok/campaigns';
import { updateAdGroupStatus, updateAdGroupBudget } from '@/lib/tiktok/campaign-actions';
import { MIN_DAILY_BUDGET_ADGROUP, TIKTOK_BUDGET_MODE_DAY } from '@/lib/tiktok/budget-limits';

type Params = { params: Promise<{ adgroupId: string }> };

type ActionBody =
  | { action: 'pause'; advertiser_id: string }
  | { action: 'enable'; advertiser_id: string }
  | { action: 'budget'; advertiser_id: string; amount: number };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { adgroupId } = await params;

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

  const owned = await verifyAdGroupOwnership(token, body.advertiser_id, adgroupId).catch(() => null);
  if (!owned) return errorResponse('Ad group does not belong to the supplied advertiser_id', 403);

  try {
    if (body.action === 'pause') {
      await updateAdGroupStatus(token, body.advertiser_id, [adgroupId], 'DISABLE');
      return Response.json({ success: true });
    }
    if (body.action === 'enable') {
      await updateAdGroupStatus(token, body.advertiser_id, [adgroupId], 'ENABLE');
      return Response.json({ success: true });
    }
    if (body.action === 'budget') {
      const { amount } = body;
      if (!Number.isFinite(amount) || amount <= 0) return errorResponse('Invalid budget: amount must be > 0', 400);
      // budget_mode comes from the ownership lookup (TikTok's real, stored value), never the client body.
      if (owned.budget_mode === TIKTOK_BUDGET_MODE_DAY && amount < MIN_DAILY_BUDGET_ADGROUP) {
        return errorResponse(`Daily budget must be at least $${MIN_DAILY_BUDGET_ADGROUP}`, 400);
      }
      await updateAdGroupBudget(token, body.advertiser_id, adgroupId, amount);
      return Response.json({ success: true });
    }
    return errorResponse('Unknown action', 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'TikTok API error';
    return errorResponse(message, 502);
  }
}
