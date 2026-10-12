/**
 * TikTok per-user OAuth connection lifecycle (`tiktok_connections`, one row per user).
 * This is the ONLY module that reads/writes `tiktok_connections` — other lib/tiktok/*
 * modules receive a bare access token + advertiser_id and never touch the token table.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { tiktokPost } from './tiktok-client';

/** Refresh proactively once the token is within this window of expiry. */
const REFRESH_BUFFER_MS = 30 * 60 * 1000;

interface TiktokConnectionRow {
  user_id: string;
  access_token: string;
  /** Null for Marketing API advertiser tokens — they are long-term and come without one. */
  refresh_token: string | null;
  /** Null = long-term token that never expires (only revocable). */
  token_expires_at: string | null;
  connected_at: string;
  updated_at: string;
}

export interface TiktokTokenExchangeData {
  access_token: string;
  /** Not always rotated by TikTok, but persisted whenever present — see writeTokens(). */
  refresh_token?: string;
  /** Absent for long-term advertiser tokens (Marketing API v1.3) — see writeTokens(). */
  access_token_expire_in?: number;
  advertiser_ids: string[];
  scope: number[];
}

/** Internal-only: full row including tokens. Callers outside lib/tiktok/* must never forward this. */
export async function getConnection(userId: string): Promise<TiktokConnectionRow | null> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('tiktok_connections')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  // Surface DB errors instead of misreporting them as "not connected".
  if (error) throw new Error(`Failed to load TikTok connection: ${error.message}`);
  return (data as TiktokConnectionRow | null) ?? null;
}

/** Safe for API responses — never selects access_token/refresh_token. */
export async function getConnectionStatus(userId: string): Promise<{ connected: boolean; connected_at: string | null }> {
  const service = createServiceClient();
  const { data } = await service
    .from('tiktok_connections')
    .select('connected_at')
    .eq('user_id', userId)
    .maybeSingle();
  const row = data as { connected_at: string | null } | null;
  return { connected: !!row, connected_at: row?.connected_at ?? null };
}

/** Subset of `userIds` that have a TikTok connection. Selects user_id only — safe for loaders. */
export async function listConnectedUserIds(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const service = createServiceClient();
  const { data, error } = await service.from('tiktok_connections').select('user_id').in('user_id', userIds);
  if (error) throw new Error(`Failed to load TikTok connections: ${error.message}`);
  return ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
}

/** Null expiry = long-term token, never "expiring". */
export function isTokenExpiringSoon(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - Date.now() < REFRESH_BUFFER_MS;
}

/** Persists tokens from an exchange/refresh response. Always writes refresh_token defensively when present.
 * Marketing API advertiser tokens are long-term (no access_token_expire_in, no refresh_token —
 * TikTok docs "Obtain a long-term access token"), so a missing expiry is stored as null rather
 * than guessed: a guessed 24h expiry made us "refresh" a token that has no refresh flow,
 * which TikTok rejects ("auth_code: Missing data for required field"). */
async function writeTokens(data: TiktokTokenExchangeData, userId: string, connectedAt: string | null, freshConnect = false): Promise<void> {
  const service = createServiceClient();
  const expireInSeconds = Number(data.access_token_expire_in);
  const tokenExpiresAt = data.access_token_expire_in != null && Number.isFinite(expireInSeconds)
    ? new Date(Date.now() + expireInSeconds * 1000).toISOString()
    : null;

  const row: Record<string, unknown> = {
    user_id: userId,
    access_token: data.access_token,
    token_expires_at: tokenExpiresAt,
    updated_at: new Date().toISOString(),
  };
  if (data.refresh_token) row.refresh_token = data.refresh_token;
  // Fresh connect: clear any old refresh_token so it can't pair with the new access token.
  else if (freshConnect) row.refresh_token = null;
  if (connectedAt) row.connected_at = connectedAt;

  const { error } = await service.from('tiktok_connections').upsert(row, { onConflict: 'user_id' });
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

/** Saves the user's fresh connection after a successful OAuth exchange. connected_at resets to now. */
export async function saveConnection(data: TiktokTokenExchangeData, userId: string): Promise<void> {
  await writeTokens(data, userId, new Date().toISOString(), true);
}

/** Deletes the user's connection row. Does not touch tiktok_ad_accounts — caller's responsibility. */
export async function deleteConnection(userId: string): Promise<void> {
  const service = createServiceClient();
  const { error } = await service.from('tiktok_connections').delete().eq('user_id', userId);
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
    const fresh = await getConnection(conn.user_id);
    if (fresh && fresh.updated_at !== conn.updated_at && !isTokenExpiringSoon(fresh.token_expires_at)) {
      return fresh.access_token;
    }
    throw new Error('TIKTOK_RECONNECT_REQUIRED', { cause: err });
  }

  // TikTok call succeeded — a failure persisting it is a transient DB error, not an invalid
  // refresh_token, so it must not be misdiagnosed as TIKTOK_RECONNECT_REQUIRED.
  await writeTokens(data, conn.user_id, conn.connected_at);
  return data.access_token;
}

/**
 * Returns the user's valid access token, refreshing if needed.
 * Fan-out callers MUST call this once per user per request and reuse the token across
 * that user's advertisers — never once per advertiser.
 */
export async function getValidAccessToken(userId: string): Promise<string> {
  const conn = await getConnection(userId);
  if (!conn) throw new Error('TIKTOK_NOT_CONNECTED');
  // No refresh_token = long-term advertiser token: nothing to refresh, use as-is.
  if (conn.refresh_token && isTokenExpiringSoon(conn.token_expires_at)) {
    return refreshAccessToken(conn);
  }
  return conn.access_token;
}

/** Maps a getValidAccessToken() failure to an HTTP status + user-facing message, surfacing the
 * real cause of a refresh failure (attached via `cause`) so bugs are diagnosable from the UI. */
export function describeAuthError(err: unknown): { status: number; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'TIKTOK_NOT_CONNECTED') {
    return { status: 400, message: 'TikTok is not connected. Connect in Settings.' };
  }
  if (message === 'TIKTOK_RECONNECT_REQUIRED') {
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined;
    return {
      status: 409,
      message: cause
        ? `TikTok connection expired — reconnect in Settings. (${cause})`
        : 'TikTok connection expired — reconnect in Settings.',
    };
  }
  return { status: 502, message };
}
