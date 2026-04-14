/**
 * GET /api/settings/accounts?token=xxx
 * Fetches all FB ad accounts accessible by the given token via FB API.
 * Used by settings page to discover accounts before saving.
 */

import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { fetchAdAccounts } from '@/lib/facebook/ad-accounts';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const token = request.nextUrl.searchParams.get('token');
  if (!token) return errorResponse('token query param required', 400);

  try {
    const accounts = await fetchAdAccounts(token);
    return Response.json({ accounts });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch accounts';
    return errorResponse(message, 502);
  }
}
