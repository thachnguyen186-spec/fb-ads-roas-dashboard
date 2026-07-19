/**
 * GET /api/tiktok/oauth/callback
 * Admin-only. Validates the CSRF `state` cookie, exchanges the auth code for tokens,
 * saves the singleton connection, and syncs `tiktok_advertiser_accounts` — preserving
 * is_selected for advertisers already present, removing stale rows no longer granted.
 */

import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';
import { exchangeAuthCode, saveConnection, type TiktokTokenExchangeData } from '@/lib/tiktok/tiktok-connection';
import { tiktokGet } from '@/lib/tiktok/tiktok-client';
import { TIKTOK_OAUTH_STATE_COOKIE } from '@/lib/tiktok/oauth-state';

/**
 * Scope ID(s) required for campaign/ad-group read+write + reporting (research report
 * Unresolved Q1 — TikTok doesn't publicly document scope IDs). Leave empty until confirmed
 * in the Developer Portal during app registration; an empty list skips the check rather
 * than blocking every connection attempt on an unverified guess.
 */
const REQUIRED_SCOPES: number[] = [];

interface RawAdvertiserInfo {
  advertiser_id: string;
  name?: string;
  currency?: string;
}

/** Best-effort enrichment — falls back to id-as-name / 'USD' if the lookup fails or a field is missing. */
async function fetchAdvertiserInfo(
  advertiserIds: string[],
  token: string,
): Promise<Map<string, { name: string; currency: string }>> {
  const map = new Map<string, { name: string; currency: string }>();
  if (advertiserIds.length === 0) return map;
  try {
    const data = await tiktokGet<{ list: RawAdvertiserInfo[] }>('/advertiser/info/', {
      advertiser_ids: JSON.stringify(advertiserIds),
      fields: JSON.stringify(['name', 'currency']),
    }, token);
    if (!data.list?.length) {
      console.warn('[tiktok] /advertiser/info/ returned no list entries — response keys:', Object.keys(data));
    }
    for (const info of data.list ?? []) {
      if (!info.name) console.warn(`[tiktok] /advertiser/info/ entry for ${info.advertiser_id} has no name field — keys:`, Object.keys(info));
      map.set(info.advertiser_id, { name: info.name ?? info.advertiser_id, currency: info.currency ?? 'USD' });
    }
  } catch (err) {
    // Non-fatal — enrichment can be re-run on the next reconnect. Logged so a real cause
    // (missing scope, wrong field name) is diagnosable instead of silently falling back to id-as-name.
    console.error('[tiktok] /advertiser/info/ lookup failed, falling back to id-as-name:', err);
  }
  return map;
}

/**
 * Upserts new/existing advertisers (never touching is_selected) and deletes rows no longer
 * granted. An empty advertiserIds is treated as a failed sync (throws) rather than "TikTok
 * says you now have zero accounts" — a scope hiccup or API glitch must not silently wipe
 * every previously-selected advertiser row.
 */
async function syncAdvertiserAccounts(advertiserIds: string[], token: string): Promise<void> {
  if (advertiserIds.length === 0) {
    throw new Error('TikTok authorization returned zero advertiser accounts.');
  }

  const service = createServiceClient();
  const infoMap = await fetchAdvertiserInfo(advertiserIds, token);

  const rows = advertiserIds.map((id) => ({
    advertiser_id: id,
    name: infoMap.get(id)?.name ?? id,
    currency: infoMap.get(id)?.currency ?? 'USD',
  }));
  // is_selected is intentionally omitted: existing rows keep their current selection,
  // new rows get the column default (true).
  const { error } = await service.from('tiktok_advertiser_accounts').upsert(rows, { onConflict: 'advertiser_id' });
  if (error) throw new Error(error.message);

  const { data: existing } = await service.from('tiktok_advertiser_accounts').select('advertiser_id');
  const staleIds = ((existing ?? []) as { advertiser_id: string }[])
    .map((r) => r.advertiser_id)
    .filter((id) => !advertiserIds.includes(id));
  if (staleIds.length > 0) {
    await service.from('tiktok_advertiser_accounts').delete().in('advertiser_id', staleIds);
  }
}

function hasRequiredScopes(granted: number[] | undefined): boolean {
  if (REQUIRED_SCOPES.length === 0) return true;
  const grantedSet = new Set(granted ?? []);
  return REQUIRED_SCOPES.every((s) => grantedSet.has(s));
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin']);
  if (denied) return denied;

  const settingsUrl = (status: 'connected' | 'error', reason?: string, detail?: string) => {
    const url = new URL('/settings', request.url);
    url.searchParams.set('tiktok', status);
    if (reason) url.searchParams.set('reason', reason);
    // Truncated so a verbose Postgres/TikTok error message doesn't blow out the redirect URL.
    if (detail) url.searchParams.set('detail', detail.slice(0, 200));
    return url.toString();
  };

  /** Logs the real error to Vercel's function logs (admin-only route — safe to log verbatim)
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
  // of auth_code. Only once state is confirmed valid does a missing auth_code mean the admin
  // denied/cancelled authorization at the TikTok portal (distinct, less alarming UX message).
  if (!state || !cookieState || state !== cookieState) {
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
    await syncAdvertiserAccounts(tokenData.advertiser_ids ?? [], tokenData.access_token);
  } catch (err) {
    // Connection is already live at this point — don't send the admin back through a fresh
    // OAuth round-trip; tell them the account list needs a retry instead.
    return Response.redirect(settingsUrl('connected', 'sync_failed', logAndDescribe('syncAdvertiserAccounts', err)), 302);
  }

  return Response.redirect(settingsUrl('connected'), 302);
}
