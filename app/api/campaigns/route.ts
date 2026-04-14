/**
 * GET /api/campaigns?accountId=act_XXXXX
 * Fetches today's Facebook campaign data for a specific ad account.
 * Requires fb_access_token in user's profile and accountId in fb_ad_accounts.
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { fetchCampaigns } from '@/lib/facebook/campaigns';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const accountId = request.nextUrl.searchParams.get('accountId');
  if (!accountId) return errorResponse('accountId query param required', 400);

  const service = createServiceClient();

  // Load token from profiles
  const { data: profile, error: profileError } = await service
    .from('profiles')
    .select('fb_access_token')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) return errorResponse('Profile not found', 404);

  const { fb_access_token } = profile as { fb_access_token: string | null };
  if (!fb_access_token) {
    return errorResponse(
      'Facebook access token not configured. Go to Settings to add your token.',
      400,
    );
  }

  // Verify this account belongs to the user
  const { data: account } = await service
    .from('fb_ad_accounts')
    .select('account_id')
    .eq('account_id', accountId)
    .eq('user_id', user.id)
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
