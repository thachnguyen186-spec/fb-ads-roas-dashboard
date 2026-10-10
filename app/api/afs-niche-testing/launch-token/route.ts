/**
 * GET    /api/afs-niche-testing/launch-token → { has_token, granted_scopes, verified_at, missing_scopes }
 * PUT    /api/afs-niche-testing/launch-token → verify against /me/permissions, encrypt, upsert
 * DELETE /api/afs-niche-testing/launch-token → remove the stored token
 *
 * Never return token material (ciphertext or plaintext) in any response. Never log the raw token.
 * admin|leader only.
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';
import { looksLikeFbAccessToken } from '@/lib/facebook/fb-client';
import { saveLaunchToken, missingScopes } from '@/lib/afs/launch-token';

interface TokenRow {
  granted_scopes: string[] | null;
  verified_at: string | null;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin', 'leader']);
  if (denied) return denied;

  const service = createServiceClient();
  const { data } = await service
    .from('afs_launch_tokens')
    .select('granted_scopes, verified_at')
    .eq('user_id', user.id)
    .maybeSingle();

  const row = data as TokenRow | null;
  const granted = row?.granted_scopes ?? [];
  return Response.json({
    has_token: !!row,
    granted_scopes: granted,
    verified_at: row?.verified_at ?? null,
    missing_scopes: missingScopes(granted),
  });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin', 'leader']);
  if (denied) return denied;

  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!looksLikeFbAccessToken(token)) {
    return errorResponse('That does not look like a valid Facebook User Access Token.', 400);
  }

  try {
    const result = await saveLaunchToken(user.id, token);
    return Response.json(result);
  } catch (err) {
    // A bad pasted token is user error, not a server failure — surface the FB message as a 400.
    return errorResponse(err instanceof Error ? err.message : 'Token verification failed', 400);
  }
}

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin', 'leader']);
  if (denied) return denied;

  const service = createServiceClient();
  const { error } = await service.from('afs_launch_tokens').delete().eq('user_id', user.id);
  if (error) return errorResponse(error.message, 500);

  return Response.json({ success: true });
}
