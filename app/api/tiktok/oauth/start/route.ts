/**
 * GET /api/tiktok/oauth/start
 * Admin-only (org-wide singleton connection — see phase-02 red-team fix; leader is
 * excluded because re-authorizing rebinds the org's entire TikTok integration).
 * Generates a CSRF `state` nonce in a short-lived httpOnly cookie and redirects to
 * TikTok's authorize URL.
 */

import { randomUUID } from 'crypto';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';
import { TIKTOK_OAUTH_STATE_COOKIE } from '@/lib/tiktok/oauth-state';

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin']);
  if (denied) return denied;

  const appId = process.env.TIKTOK_APP_ID;
  const redirectUri = process.env.TIKTOK_OAUTH_REDIRECT_URI;
  if (!appId || !redirectUri) {
    return errorResponse('TIKTOK_APP_ID/TIKTOK_OAUTH_REDIRECT_URI not configured on server.', 400);
  }

  const state = randomUUID();
  const cookieStore = await cookies();
  cookieStore.set(TIKTOK_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });

  const url = new URL('https://business-api.tiktok.com/portal/auth');
  url.searchParams.set('app_id', appId);
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', redirectUri);

  return Response.redirect(url.toString(), 302);
}
