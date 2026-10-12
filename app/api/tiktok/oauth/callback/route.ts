/**
 * GET /api/tiktok/oauth/callback
 * Any authenticated user (per-user connection). Validates the CSRF `state` cookie (bound to
 * the user who started the flow), exchanges the auth code for tokens, saves that user's
 * connection, and syncs their `tiktok_ad_accounts` rows.
 */

import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { exchangeAuthCode, saveConnection, type TiktokTokenExchangeData } from '@/lib/tiktok/tiktok-connection';
import { syncUserAdvertisers } from '@/lib/tiktok/advertiser-sync';
import { TIKTOK_OAUTH_STATE_COOKIE, matchesOauthState } from '@/lib/tiktok/oauth-state';

/**
 * Scope ID(s) required for campaign/ad-group read+write + reporting (research report
 * Unresolved Q1 — TikTok doesn't publicly document scope IDs). Leave empty until confirmed
 * in the Developer Portal during app registration; an empty list skips the check rather
 * than blocking every connection attempt on an unverified guess.
 */
const REQUIRED_SCOPES: number[] = [];

function hasRequiredScopes(granted: number[] | undefined): boolean {
  if (REQUIRED_SCOPES.length === 0) return true;
  const grantedSet = new Set(granted ?? []);
  return REQUIRED_SCOPES.every((s) => grantedSet.has(s));
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const settingsUrl = (status: 'connected' | 'error', reason?: string, detail?: string) => {
    const url = new URL('/settings', request.url);
    url.searchParams.set('tiktok', status);
    if (reason) url.searchParams.set('reason', reason);
    // Truncated so a verbose Postgres/TikTok error message doesn't blow out the redirect URL.
    if (detail) url.searchParams.set('detail', detail.slice(0, 200));
    return url.toString();
  };

  /** Logs the real error to Vercel's function logs (error details go only to the same user — safe to log verbatim)
   * and returns a short message safe to surface in the Settings UI. */
  function logAndDescribe(step: string, err: unknown): string {
    console.error(`[tiktok oauth callback] ${step} failed:`, err);
    return err instanceof Error ? err.message : String(err);
  }

  const authCode = request.nextUrl.searchParams.get('auth_code');
  const state = request.nextUrl.searchParams.get('state');
  const cookieStore = await cookies();
  const cookieState = cookieStore.get(TIKTOK_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(TIKTOK_OAUTH_STATE_COOKIE);

  // CSRF check first: a missing/mismatched state is a real tampering/expiry signal regardless
  // of auth_code. Only once state is confirmed valid does a missing auth_code mean the user
  // denied/cancelled authorization at the TikTok portal (distinct, less alarming UX message).
  if (!matchesOauthState(cookieState, user.id, state)) {
    return Response.redirect(settingsUrl('error', 'state'), 302);
  }
  if (!authCode) {
    return Response.redirect(settingsUrl('error', 'denied'), 302);
  }

  let tokenData: TiktokTokenExchangeData;
  try {
    tokenData = await exchangeAuthCode(authCode);
  } catch (err) {
    return Response.redirect(settingsUrl('error', 'exchange', logAndDescribe('exchangeAuthCode', err)), 302);
  }

  if (!hasRequiredScopes(tokenData.scope)) {
    return Response.redirect(settingsUrl('error', 'scope'), 302);
  }

  try {
    await saveConnection(tokenData, user.id);
  } catch (err) {
    return Response.redirect(settingsUrl('error', 'save', logAndDescribe('saveConnection', err)), 302);
  }

  try {
    await syncUserAdvertisers(user.id, tokenData.advertiser_ids ?? [], tokenData.access_token);
  } catch (err) {
    // Connection is already live at this point — don't send the user back through a fresh
    // OAuth round-trip; tell them the account list needs a retry instead.
    return Response.redirect(settingsUrl('connected', 'sync_failed', logAndDescribe('syncUserAdvertisers', err)), 302);
  }

  return Response.redirect(settingsUrl('connected'), 302);
}
