/**
 * GET /api/campaigns?accountId=act_XXXXX[&viewAs=userId]
 * Fetches today's Facebook campaign data for a specific ad account.
 *
 * viewAs: optional — leader/admin can pass a staff user's ID to load
 * campaigns using that staff member's token. Token never leaves the server.
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { canViewAs } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';
import { fetchCampaigns } from '@/lib/facebook/campaigns';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const accountId = request.nextUrl.searchParams.get('accountId');
  if (!accountId) return errorResponse('accountId query param required', 400);

  const viewAs = request.nextUrl.searchParams.get('viewAs');
  // The effective user whose token and accounts we use
  const targetUserId = viewAs ?? user.id;

  // If viewAs is set, verify the requester has permission to view that user
  if (viewAs && viewAs !== user.id) {
    const denied = await canViewAs(user.id, viewAs);
    if (denied) return denied;
  }

  const service = createServiceClient();

  // Load token from the target user's profile
  const { data: profile, error: profileError } = await service
    .from('profiles')
    .select('fb_access_token')
    .eq('id', targetUserId)
    .single();

  if (profileError || !profile) return errorResponse('Profile not found', 404);

  const { fb_access_token } = profile as { fb_access_token: string | null };
  if (!fb_access_token) {
    return errorResponse(
      'Facebook access token not configured for this user.',
      400,
    );
  }

  // Verify the account belongs to the target user
  const { data: account } = await service
    .from('fb_ad_accounts')
    .select('account_id')
    .eq('account_id', accountId)
    .eq('user_id', targetUserId)
    .single();

  if (!account) return errorResponse('Ad account not found', 404);

  try {
    const campaigns = await fetchCampaigns(fb_access_token, accountId);
    return Response.json({ campaigns });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch campaigns';
    const isTokenErr = /token|session|oauth|expired/i.test(message);
    return errorResponse(
      isTokenErr
        ? `Facebook token error: ${message}. Go to Settings and refresh your access token.`
        : message,
      502,
    );
  }
}
