/**
 * PATCH /api/tiktok/campaigns/[campaignId]
 * Executes pause/enable/budget actions. Any role may act, but only on advertisers they
 * connected + selected, using their own token (mirrors FB own-token rule; viewAs ignored).
 */

import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { resolveOwnAdvertiserToken } from '@/lib/tiktok/control-guard';
import { verifyCampaignOwnership } from '@/lib/tiktok/campaigns';
import { updateCampaignStatus, updateCampaignBudget } from '@/lib/tiktok/campaign-actions';
import { MIN_DAILY_BUDGET_CAMPAIGN, TIKTOK_BUDGET_MODE_DAY } from '@/lib/tiktok/budget-limits';

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

  let body: ActionBody;
  try {
    body = await request.json() as ActionBody;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  if (!body.advertiser_id) return errorResponse('advertiser_id is required', 400);

  const token = await resolveOwnAdvertiserToken(user.id, body.advertiser_id);
  if (token instanceof Response) return token;

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
      if (owned.budget_mode === TIKTOK_BUDGET_MODE_DAY && amount < MIN_DAILY_BUDGET_CAMPAIGN) {
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
