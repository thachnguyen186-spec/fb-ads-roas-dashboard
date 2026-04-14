/**
 * PATCH /api/adsets/[adsetId]
 * Updates an ad set's budget via FB Marketing API v21.
 * Body: { action: 'budget', budget_type: 'daily' | 'lifetime', amount_usd: number }
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { updateAdSetBudget } from '@/lib/facebook/adset-actions';

type Params = { params: Promise<{ adsetId: string }> };

type ActionBody = { action: 'budget'; budget_type: 'daily' | 'lifetime'; amount: number; currency: string };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { adsetId } = await params;
  if (!/^\d+$/.test(adsetId)) return errorResponse('Invalid adsetId', 400);

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  let body: ActionBody;
  try {
    body = await request.json() as ActionBody;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (body.action !== 'budget') return errorResponse('Unsupported action', 400);
  if (body.budget_type !== 'daily' && body.budget_type !== 'lifetime') {
    return errorResponse('Invalid budget_type', 400);
  }
  const { amount, currency } = body;
  if (typeof amount !== 'number' || amount <= 0) {
    return errorResponse('Invalid amount: must be > 0', 400);
  }

  const service = createServiceClient();
  const { data: profile } = await service
    .from('profiles')
    .select('fb_access_token')
    .eq('id', user.id)
    .single();

  const token = (profile as { fb_access_token?: string | null } | null)?.fb_access_token;
  if (!token) return errorResponse('Facebook token not configured', 400);

  try {
    await updateAdSetBudget(token, adsetId, body.budget_type, amount, currency);
    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Budget update failed';
    return errorResponse(message, 502);
  }
}
