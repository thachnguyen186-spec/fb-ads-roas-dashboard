/**
 * PATCH /api/spending-limits/:accountId
 * Updates the per-account alert threshold and resets the alert_sent dedup flag
 * (so the next threshold crossing fires an alert again).
 *
 * Body: { alert_threshold: number | null }   // null disables alerting
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const { accountId } = await params;
  if (!accountId) return errorResponse('accountId required', 400);

  let body: { alert_threshold?: unknown };
  try {
    body = (await request.json()) as { alert_threshold?: unknown };
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const raw = body.alert_threshold;
  let alert_threshold: number | null;
  if (raw === null || raw === undefined || raw === '') {
    alert_threshold = null;
  } else if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    alert_threshold = raw;
  } else {
    return errorResponse('alert_threshold must be a non-negative number or null', 400);
  }

  const service = createServiceClient();
  const { error, count } = await service
    .from('fb_ad_accounts')
    .update({ alert_threshold, alert_sent: false }, { count: 'exact' })
    .eq('account_id', accountId)
    .eq('user_id', user.id);

  if (error) return errorResponse(error.message, 500);
  if (!count) return errorResponse('Account not found', 404);
  return Response.json({ success: true, alert_threshold });
}
