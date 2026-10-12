/**
 * GET /api/tiktok/oauth/start
 * Any authenticated user (per-user connection — each user authorizes their own token).
 * Generates a CSRF nonce, stores `${user.id}:${nonce}` in a short-lived httpOnly cookie
 * (binds the flow to this user), and redirects to TikTok's authorize URL with state=nonce.
 */

import { randomUUID } from 'crypto';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { TIKTOK_OAUTH_STATE_COOKIE, buildOauthStateCookie } from '@/lib/tiktok/oauth-state';

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const appId = process.env.TIKTOK_APP_ID;
  const redirectUri = process.env.TIKTOK_OAUTH_REDIRECT_URI;
  if (!appId || !redirectUri) {
    return errorResponse('TIKTOK_APP_ID/TIKTOK_OAUTH_REDIRECT_URI not configured on server.', 400);
  }

  const state = randomUUID();
  const cookieStore = await cookies();
  cookieStore.set(TIKTOK_OAUTH_STATE_COOKIE, buildOauthStateCookie(user.id, state), {
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
