/**
 * Shared ownership gate for TikTok control routes (pause/enable/budget).
 * Mirrors FB: a user may only act on advertisers THEY connected and selected, always with
 * their own token — never another user's, even for leader/admin viewing a staff member.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { getValidAccessToken, describeAuthError } from './tiktok-connection';

/** Returns the requester's token when they own (and selected) the advertiser, else an error Response. */
export async function resolveOwnAdvertiserToken(userId: string, advertiserId: string): Promise<string | Response> {
  const service = createServiceClient();
  const { data: account } = await service
    .from('tiktok_ad_accounts')
    .select('advertiser_id')
    .eq('advertiser_id', advertiserId)
    .eq('user_id', userId)
    .eq('is_selected', true)
    .maybeSingle();
  if (!account) {
    return errorResponse('You can only control TikTok accounts you connected (and selected) in Settings', 403);
  }

  try {
    return await getValidAccessToken(userId);
  } catch (err) {
    const { status, message } = describeAuthError(err);
    return errorResponse(message, status);
  }
}
