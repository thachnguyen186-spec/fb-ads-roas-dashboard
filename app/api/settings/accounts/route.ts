/**
 * POST /api/settings/accounts
 * Fetches all FB ad accounts accessible by the given token via FB API.
 * Token is accepted in the JSON body (never in URL query params to avoid log exposure).
 */

import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { fetchAdAccounts } from '@/lib/facebook/ad-accounts';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  let token: string | undefined;
  try {
    const body = await request.json() as { token?: string };
    token = body.token;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  if (!token) return errorResponse('token required', 400);

  try {
    const accounts = await fetchAdAccounts(token);
    return Response.json({ accounts });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch accounts';
    return errorResponse(message, 502);
  }
}
