/**
 * DELETE /api/settings/accounts/:accountId
 * Removes an ad account from the user's saved list.
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const { accountId } = await params;
  if (!accountId) return errorResponse('accountId required', 400);

  const service = createServiceClient();
  const { error } = await service
    .from('fb_ad_accounts')
    .delete()
    .eq('account_id', accountId)
    .eq('user_id', user.id);

  if (error) return errorResponse(error.message, 500);
  return Response.json({ success: true });
}
