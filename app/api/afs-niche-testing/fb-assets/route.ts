/**
 * GET /api/afs-niche-testing/fb-assets?accountId=act_XXXXX
 * Returns the dropdown data the publish UI needs in one call: the user's saved FB ad
 * accounts, the launch token's reachable Pages, and (if `accountId` is given) that account's
 * pixels. Pixel fetch failures are non-fatal (surfaced via `warnings`); Page fetch failures
 * are fatal (a Page is required to create ad creatives).
 * admin|leader only.
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';
import { getLaunchToken } from '@/lib/afs/launch-token';
import { fetchPages } from '@/lib/facebook/pages';
import { fetchPixels } from '@/lib/facebook/pixels';
import type { FbAdAccount, FbPixel } from '@/lib/types';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin', 'leader']);
  if (denied) return denied;

  const accountId = request.nextUrl.searchParams.get('accountId');

  let token: string;
  try {
    token = await getLaunchToken(user.id);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'No launch token configured', 400);
  }

  const service = createServiceClient();
  const { data: accountsData, error: accountsErr } = await service
    .from('fb_ad_accounts')
    .select('account_id,name,is_selected,account_status,currency')
    .eq('user_id', user.id);
  if (accountsErr) return errorResponse(accountsErr.message, 500);
  const ad_accounts = (accountsData ?? []) as FbAdAccount[];

  let pages;
  try {
    pages = await fetchPages(token);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Failed to load Facebook Pages', 502);
  }

  const warnings: string[] = [];
  let pixels: FbPixel[] = [];
  // Ownership check — every other AFS route scopes by the caller's own rows; accountId is a raw
  // query param here, so without this a signed-in user could probe another user's ad accounts
  // for pixel names (bounded by the launch token's own FB permissions, but still inconsistent).
  if (accountId && ad_accounts.some((a) => a.account_id === accountId)) {
    const pixelResult = await fetchPixels(token, accountId);
    pixels = pixelResult.pixels;
    if (pixelResult.warning) warnings.push(pixelResult.warning);
  } else if (accountId) {
    warnings.push('Selected ad account is not in your saved accounts — pixels unavailable.');
  }

  return Response.json({ pages, pixels, warnings, ad_accounts });
}
