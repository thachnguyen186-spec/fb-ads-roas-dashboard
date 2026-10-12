/**
 * PATCH /api/tiktok/adgroups/[adgroupId]
 * Same shape as /api/tiktok/campaigns/[campaignId] at ad-group level — own selected advertiser
 * + own token (any role), ad-group ownership check, DAILY-mode-only budget minimum.
 */

import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { resolveOwnAdvertiserToken } from '@/lib/tiktok/control-guard';
import { verifyAdGroupOwnership } from '@/lib/tiktok/campaigns';
import { updateAdGroupStatus, updateAdGroupBudget } from '@/lib/tiktok/campaign-actions';

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

  let body: ActionBody;
  try {
    body = await request.json() as ActionBody;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  if (!body.advertiser_id) return errorResponse('advertiser_id is required', 400);

  const token = await resolveOwnAdvertiserToken(user.id, body.advertiser_id);
  if (token instanceof Response) return token;

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
      // No local minimum: TikTok enforces its own (varies by account/currency) and its error is returned.
      await updateAdGroupBudget(token, body.advertiser_id, adgroupId, amount);
      return Response.json({ success: true });
    }
    return errorResponse('Unknown action', 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'TikTok API error';
    console.error('[tiktok adgroup action] failed:', body.action, message);
    return errorResponse(message, 502);
  }
}
