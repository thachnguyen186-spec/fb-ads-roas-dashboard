/**
 * GET /api/campaigns/[campaignId]/adsets
 * Fetches active ad sets for a campaign with today's insights.
 * Query params: accountId, accountName, currency (known by client from campaign row)
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { fetchAdSets, fetchAdSetsForDuplicate } from '@/lib/facebook/adsets';

type Params = { params: Promise<{ campaignId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { campaignId } = await params;
  if (!/^\d+$/.test(campaignId)) return errorResponse('Invalid campaignId', 400);

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const sp = request.nextUrl.searchParams;
  const accountId = sp.get('accountId') ?? '';
  const accountName = sp.get('accountName') ?? '';
  const currency = sp.get('currency') ?? 'USD';
  const all = sp.get('all') === 'true';

  const service = createServiceClient();
  const { data: profile } = await service
    .from('profiles')
    .select('fb_access_token')
    .eq('id', user.id)
    .single();

  const token = (profile as { fb_access_token?: string | null } | null)?.fb_access_token;
  if (!token) return errorResponse('Facebook access token not configured.', 400);

  try {
    // ?all=true — lightweight fetch for duplicate modal (no spend filter, no insights)
    if (all) {
      const adsets = await fetchAdSetsForDuplicate(token, campaignId);
      return Response.json({ adsets });
    }
    const adsets = await fetchAdSets(token, campaignId, accountId, accountName, currency);
    return Response.json({ adsets });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch ad sets';
    return errorResponse(message, 502);
  }
}
