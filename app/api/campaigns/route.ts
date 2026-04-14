/**
 * GET /api/campaigns[?viewAs=userId]
 * Fetches today's active Facebook campaigns across ALL of the user's selected
 * ad accounts in parallel. Each campaign row includes account_id + account_name.
 *
 * viewAs: optional — leader/admin can pass a staff user's ID to load
 * that user's campaigns using their token. Token never leaves the server.
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

  const viewAs = request.nextUrl.searchParams.get('viewAs');
  const targetUserId = viewAs ?? user.id;

  if (viewAs && viewAs !== user.id) {
    const denied = await canViewAs(user.id, viewAs);
    if (denied) return denied;
  }

  const service = createServiceClient();

  // Load token + selected accounts for the target user in parallel
  const [profileRes, accountsRes] = await Promise.all([
    service.from('profiles').select('fb_access_token').eq('id', targetUserId).single(),
    service
      .from('fb_ad_accounts')
      .select('account_id, name, currency')
      .eq('user_id', targetUserId)
      .eq('is_selected', true),
  ]);

  if (!profileRes.data) return errorResponse('Profile not found', 404);
  const { fb_access_token } = profileRes.data as { fb_access_token: string | null };
  if (!fb_access_token) return errorResponse('Facebook access token not configured.', 400);

  const accounts = (accountsRes.data ?? []) as { account_id: string; name: string; currency: string }[];
  if (accounts.length === 0) return errorResponse('No ad accounts selected. Go to Settings.', 400);

  try {
    // Fetch all accounts in parallel
    const results = await Promise.all(
      accounts.map((a) => fetchCampaigns(fb_access_token, a.account_id, a.name, a.currency ?? 'USD')),
    );
    const campaigns = results.flat();
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
