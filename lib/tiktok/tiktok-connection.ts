/**
 * TikTok org-wide OAuth connection lifecycle (singleton `tiktok_connection` row).
 * This is the ONLY module that reads/writes `tiktok_connection` — other lib/tiktok/*
 * modules receive a bare access token + advertiser_id and never touch the DB.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { tiktokPost } from './tiktok-client';

/** Refresh proactively once the token is within this window of expiry. */
const REFRESH_BUFFER_MS = 30 * 60 * 1000;

interface TiktokConnectionRow {
  id: boolean;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  connected_by: string | null;
  connected_at: string;
  updated_at: string;
}

export interface TiktokTokenExchangeData {
  access_token: string;
  /** Not always rotated by TikTok, but persisted whenever present — see writeTokens(). */
  refresh_token?: string;
  access_token_expire_in: number;
  advertiser_ids: string[];
  scope: number[];
}

/** Internal-only: full row including tokens. Callers outside lib/tiktok/* must never forward this. */
export async function getConnection(): Promise<TiktokConnectionRow | null> {
  const service = createServiceClient();
  const { data } = await service
    .from('tiktok_connection')
    .select('*')
    .eq('id', true)
    .maybeSingle();
  return (data as TiktokConnectionRow | null) ?? null;
}

/** Safe for API responses — never selects access_token/refresh_token. */
export async function getConnectionStatus(): Promise<{ connected: boolean; connected_at: string | null }> {
  const service = createServiceClient();
  const { data } = await service
    .from('tiktok_connection')
    .select('connected_at')
    .eq('id', true)
    .maybeSingle();
  const row = data as { connected_at: string | null } | null;
  return { connected: !!row, connected_at: row?.connected_at ?? null };
}

export function isTokenExpiringSoon(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() - Date.now() < REFRESH_BUFFER_MS;
}

/** TikTok's documented access-token lifetime (research report, §1) — used when a live
 * response omits or malforms access_token_expire_in, so a shape surprise degrades to a
 * safe default instead of crashing the whole connection (isTokenExpiringSoon will still
 * trigger a refresh well before any real expiry, so an inaccurate fallback is self-healing). */
const DEFAULT_TOKEN_LIFETIME_SECONDS = 86400;

/** Persists tokens from an exchange/refresh response. Always writes refresh_token defensively when present. */
async function writeTokens(
  data: TiktokTokenExchangeData,
  connectedBy: string | null,
  connectedAt: string | null,
): Promise<void> {
  const service = createServiceClient();
  const expireInSeconds = Number(data.access_token_expire_in);
  if (!Number.isFinite(expireInSeconds)) {
    // Never log `data` itself — it contains access_token/refresh_token. Field names only.
    console.warn('[tiktok] access_token_expire_in missing/invalid, defaulting to 24h. Response keys:', Object.keys(data));
  }
  const safeExpireInSeconds = Number.isFinite(expireInSeconds) ? expireInSeconds : DEFAULT_TOKEN_LIFETIME_SECONDS;

  const row: Record<string, unknown> = {
    id: true,
    access_token: data.access_token,
    token_expires_at: new Date(Date.now() + safeExpireInSeconds * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (data.refresh_token) row.refresh_token = data.refresh_token;
  if (connectedBy) row.connected_by = connectedBy;
  if (connectedAt) row.connected_at = connectedAt;

  const { error } = await service.from('tiktok_connection').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(`Failed to save TikTok connection: ${error.message}`);
}

/** Exchanges an OAuth authorization code for tokens. Used only by the OAuth callback route. */
export async function exchangeAuthCode(authCode: string): Promise<TiktokTokenExchangeData> {
  const appId = process.env.TIKTOK_APP_ID;
  const secret = process.env.TIKTOK_APP_SECRET;
  if (!appId || !secret) throw new Error('TIKTOK_APP_ID/TIKTOK_APP_SECRET not configured on server.');

  return tiktokPost<TiktokTokenExchangeData>('/oauth2/access_token/', {
    app_id: appId,
    secret,
    auth_code: authCode,
    grant_type: 'authorization_code',
  }, '');
}

/** Saves a fresh connection after a successful OAuth exchange. connected_by/connected_at reset to now. */
export async function saveConnection(data: TiktokTokenExchangeData, connectedBy: string): Promise<void> {
  await writeTokens(data, connectedBy, new Date().toISOString());
}

/** Deletes the singleton connection row. Does not touch tiktok_advertiser_accounts — caller's responsibility. */
export async function deleteConnection(): Promise<void> {
  const service = createServiceClient();
  const { error } = await service.from('tiktok_connection').delete().eq('id', true);
  if (error) throw new Error(`Failed to delete TikTok connection: ${error.message}`);
}

/**
 * Refreshes the access token using the stored refresh_token.
 * Race guard: if another concurrent request already refreshed successfully
 * (row's updated_at moved forward and the new token isn't expiring soon),
 * returns that fresh token instead of surfacing a false reconnect prompt.
 */
export async function refreshAccessToken(conn: TiktokConnectionRow): Promise<string> {
  const appId = process.env.TIKTOK_APP_ID;
  const secret = process.env.TIKTOK_APP_SECRET;
  if (!appId || !secret) throw new Error('TIKTOK_APP_ID/TIKTOK_APP_SECRET not configured on server.');

  let data: TiktokTokenExchangeData;
  try {
    data = await tiktokPost<TiktokTokenExchangeData>('/oauth2/access_token/', {
      app_id: appId,
      secret,
      refresh_token: conn.refresh_token,
      grant_type: 'refresh_token',
    }, '');
  } catch (err) {
    // TikTok itself rejected the refresh — race guard: another concurrent request may have
    // already refreshed successfully in the meantime.
    const fresh = await getConnection();
    if (fresh && fresh.updated_at !== conn.updated_at && !isTokenExpiringSoon(fresh.token_expires_at)) {
      return fresh.access_token;
    }
    throw new Error('TIKTOK_RECONNECT_REQUIRED', { cause: err });
  }

  // TikTok call succeeded — a failure persisting it is a transient DB error, not an invalid
  // refresh_token, so it must not be misdiagnosed as TIKTOK_RECONNECT_REQUIRED.
  await writeTokens(data, conn.connected_by, conn.connected_at);
  return data.access_token;
}

/**
 * Returns a valid access token, refreshing if needed.
 * Fan-out callers (Phase 3) MUST call this once per request and reuse the
 * token across all advertisers — never once per advertiser.
 */
export async function getValidAccessToken(): Promise<string> {
  const conn = await getConnection();
  if (!conn) throw new Error('TIKTOK_NOT_CONNECTED');
  if (isTokenExpiringSoon(conn.token_expires_at)) {
    return refreshAccessToken(conn);
  }
  return conn.access_token;
}
