/**
 * The AFS ads-launching token: a second, separate FB user token (distinct from
 * profiles.fb_access_token) scoped for campaign/asset creation. Stored encrypted in
 * afs_launch_tokens (service-role only, zero RLS policies). Never log the raw token.
 */

import { fbGet } from '@/lib/facebook/fb-client';
import { encryptToken, decryptToken } from '@/lib/crypto/token-crypto';
import { createServiceClient } from '@/lib/supabase/server';

export const REQUIRED_SCOPES = ['ads_management', 'ads_read', 'pages_show_list', 'pages_read_engagement'] as const;

interface FbPermission {
  permission: string;
  status: string;
}

/** Calls /me/permissions and returns the granted scope names. Throws the FB error message on failure. */
export async function fetchGrantedScopes(token: string): Promise<string[]> {
  const res = await fbGet('/me/permissions', {}, token) as { data?: FbPermission[] };
  const list = Array.isArray(res.data) ? res.data : [];
  return list.filter((p) => p.status === 'granted').map((p) => p.permission);
}

/** Required scopes absent from `granted`, preserving REQUIRED_SCOPES order. */
export function missingScopes(granted: string[]): string[] {
  return REQUIRED_SCOPES.filter((s) => !granted.includes(s));
}

interface SaveResult {
  granted_scopes: string[];
  missing_scopes: string[];
}

/**
 * Verifies the token against /me/permissions and upserts it encrypted.
 * Throws if the token is unverifiable or missing the hard-required `ads_management` scope —
 * nothing is stored in that case.
 */
export async function saveLaunchToken(userId: string, token: string): Promise<SaveResult> {
  const granted = await fetchGrantedScopes(token);
  if (!granted.includes('ads_management')) {
    throw new Error('Token is missing ads_management — regenerate it in Graph API Explorer with all four permissions.');
  }

  const token_enc = encryptToken(token, userId);
  const service = createServiceClient();
  const { error } = await service.from('afs_launch_tokens').upsert({
    user_id: userId,
    token_enc,
    granted_scopes: granted,
    verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);

  return { granted_scopes: granted, missing_scopes: missingScopes(granted) };
}

/** Decrypts and returns the stored launch token, or throws an actionable message if none is configured. */
export async function getLaunchToken(userId: string): Promise<string> {
  const service = createServiceClient();
  const { data } = await service
    .from('afs_launch_tokens')
    .select('token_enc')
    .eq('user_id', userId)
    .maybeSingle();

  const row = data as { token_enc: string } | null;
  if (!row) throw new Error('No ads-launching token configured — add one in Settings');

  return decryptToken(row.token_enc, userId);
}
