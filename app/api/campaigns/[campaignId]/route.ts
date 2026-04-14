/**
 * PATCH /api/campaigns/[campaignId]
 * Executes campaign actions via FB API on behalf of the authenticated user.
 * Supported actions: pause, budget update.
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { pauseCampaign, updateBudget } from '@/lib/facebook/campaign-actions';

type Params = { params: Promise<{ campaignId: string }> };

type ActionBody =
  | { action: 'pause' }
  | { action: 'budget'; budget_type: 'daily' | 'lifetime'; amount: number; currency: string };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { campaignId } = await params;

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const service = createServiceClient();
  const { data: profile } = await service
    .from('profiles')
    .select('fb_access_token')
    .eq('id', user.id)
    .single();

  const token = (profile as { fb_access_token?: string | null })?.fb_access_token;
  if (!token) return errorResponse('Facebook token not configured', 400);

  let body: ActionBody;
  try {
    body = await request.json() as ActionBody;
  } catch {
    return errorResponse('Invalid JSON body');
  }

  try {
    if (body.action === 'pause') {
      await pauseCampaign(token, campaignId);
      return Response.json({ success: true });
    }

    if (body.action === 'budget') {
      const { budget_type, amount, currency } = body;
      if (!budget_type || !amount || amount <= 0) {
        return errorResponse('Invalid budget: amount must be > 0');
      }
      await updateBudget(token, campaignId, budget_type, amount, currency);
      return Response.json({ success: true });
    }

    return errorResponse('Unknown action');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'FB API error';
    return errorResponse(message, 502);
  }
}
