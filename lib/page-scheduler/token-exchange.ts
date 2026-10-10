/**
 * Token inspection (debug_token) + optional long-lived exchange for the Page Scheduler.
 * FB_APP_ID / FB_APP_SECRET are OPTIONAL: without them debug_token is called with the pasted
 * token itself as access_token. Secrets / tokens are never logged or returned.
 */

import { fbGet, PAGE_SCHEDULER_FB_API_BASE } from '@/lib/facebook/fb-client';
import type { PsTokenType } from './types';

export interface TokenInfo {
  isValid: boolean;
  type: string;
  appId: string | null;
  /** ISO string, or null when the token never expires (debug expires_at 0/absent). */
  expiresAt: string | null;
  scopes: string[];
}

export function getAppCredentials(): { appId: string; appSecret: string } | null {
  const appId = process.env.FB_APP_ID?.trim();
  const appSecret = process.env.FB_APP_SECRET?.trim();
  return appId && appSecret ? { appId, appSecret } : null;
}

/** Configured app id (even without secret) used for the app_id mismatch check. */
export function getConfiguredAppId(): string | null {
  return process.env.FB_APP_ID?.trim() || null;
}

interface DebugResponse {
  data?: {
    is_valid?: boolean;
    type?: string;
    app_id?: string;
    expires_at?: number;
    scopes?: string[];
  };
}

export async function debugToken(token: string): Promise<TokenInfo> {
  const creds = getAppCredentials();
  const accessToken = creds ? `${creds.appId}|${creds.appSecret}` : token;
  const res = await fbGet('/debug_token', { input_token: token }, accessToken, PAGE_SCHEDULER_FB_API_BASE) as DebugResponse;
  const d = res.data;
  if (!d) throw new Error('Facebook returned no token information');
  return {
    isValid: d.is_valid === true,
    type: d.type ?? 'UNKNOWN',
    appId: d.app_id ?? null,
    expiresAt: d.expires_at && d.expires_at > 0 ? new Date(d.expires_at * 1000).toISOString() : null,
    scopes: Array.isArray(d.scopes) ? d.scopes : [],
  };
}

/** Swaps a short-lived USER token for a long-lived (~60d) one. Requires FB_APP_ID + FB_APP_SECRET. */
export async function exchangeLongLived(token: string): Promise<string> {
  const creds = getAppCredentials();
  if (!creds) throw new Error('FB app not configured');
  const url = new URL(`${PAGE_SCHEDULER_FB_API_BASE}/oauth/access_token`);
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', creds.appId);
  url.searchParams.set('client_secret', creds.appSecret);
  url.searchParams.set('fb_exchange_token', token);
  const res = await fetch(url.toString());
  const json = await res.json() as { access_token?: string; error?: { message?: string } };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error?.message ?? `Token exchange failed (HTTP ${res.status})`);
  }
  return json.access_token;
}

export function toTokenType(type: string): PsTokenType | null {
  return type === 'USER' || type === 'SYSTEM_USER' ? type : null;
}
