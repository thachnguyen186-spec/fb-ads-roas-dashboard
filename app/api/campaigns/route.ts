/**
 * GET /api/campaigns
 * Fetches today's Facebook campaign data for the authenticated user.
 * Requires fb_access_token and fb_ad_account_id in the user's profile.
 */

import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { fetchCampaigns } from '@/lib/facebook/campaigns';

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const service = createServiceClient();
  const { data: profile, error: profileError } = await service
    .from('profiles')
    .select('fb_access_token, fb_ad_account_id')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) return errorResponse('Profile not found', 404);

  const { fb_access_token, fb_ad_account_id } = profile as {
    fb_access_token: string | null;
    fb_ad_account_id: string | null;
  };

  if (!fb_access_token || !fb_ad_account_id) {
    return errorResponse(
      'Facebook credentials not configured. Go to Settings to add your Access Token and Ad Account ID.',
      400,
    );
  }

  try {
    const campaigns = await fetchCampaigns(fb_access_token, fb_ad_account_id);
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
