/**
 * FB profile (token) binding for the Page Scheduler: add / resync / remove profiles and load
 * decrypted page tokens for later phases. Tokens are encrypted at rest (AAD = user_id) and are
 * never logged or returned to the browser.
 */

import { fbGet, PAGE_SCHEDULER_FB_API_BASE } from '@/lib/facebook/fb-client';
import { encryptToken, decryptToken } from '@/lib/crypto/token-crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { classifyFbError } from './graph-errors';
import { REQUIRED_SCOPES, OPTIONAL_SCOPES } from './constants';
import { syncPagesForProfile, type SyncResult } from './page-sync';
import { debugToken, exchangeLongLived, getAppCredentials, getConfiguredAppId, toTokenType } from './token-exchange';
import type { PsProfile } from './types';

/** Never select token_enc for API-facing reads. */
export const PROFILE_PUBLIC_COLUMNS =
  'id, user_id, fb_user_id, fb_user_name, token_type, app_id, expires_at, granted_scopes, status, last_error, synced_at, created_at, updated_at';

export const NO_PAGES_HINT =
  'No Pages found — assign Pages to this system user in Business Settings → Users → System users → Assign assets (Content + Insights; Full control for profile picture).';

/** Input/permission problem caused by the pasted token (mapped to HTTP 400 by routes). */
export class PsUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PsUserError';
  }
}

export interface ProfileSyncOutcome extends Partial<SyncResult> {
  sync_error?: string;
  hint?: string;
}

export interface AddProfileResult extends ProfileSyncOutcome {
  profile: PsProfile;
  missing_optional_scopes: string[];
  warnings: string[];
}

async function grantedScopes(token: string, fromDebug: string[]): Promise<string[]> {
  if (fromDebug.length) return fromDebug;
  const res = await fbGet('/me/permissions', {}, token, PAGE_SCHEDULER_FB_API_BASE) as {
    data?: { permission: string; status: string }[];
  };
  return (res.data ?? []).filter((p) => p.status === 'granted').map((p) => p.permission);
}

export async function markProfileInvalid(profileId: string, message: string): Promise<void> {
  const service = createServiceClient();
  await service
    .from('ps_fb_profiles')
    .update({ status: 'invalid', last_error: message.slice(0, 500), updated_at: new Date().toISOString() })
    .eq('id', profileId);
}

/** Syncs one profile's Pages; auth errors flag the profile `invalid`. Never throws. */
export async function syncProfile(userId: string, profileId: string, tokenEnc: string, tokenType: string): Promise<ProfileSyncOutcome> {
  const service = createServiceClient();
  try {
    const result = await syncPagesForProfile(userId, profileId, decryptToken(tokenEnc, userId));
    const now = new Date().toISOString();
    await service
      .from('ps_fb_profiles')
      .update({ status: 'active', last_error: null, synced_at: now, updated_at: now })
      .eq('id', profileId);
    const hint = result.pages_total === 0 && tokenType === 'SYSTEM_USER' ? NO_PAGES_HINT : undefined;
    return { ...result, hint };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Page sync failed';
    if (classifyFbError(err) === 'auth') await markProfileInvalid(profileId, message);
    return { sync_error: message };
  }
}

/** Validates + stores a pasted token, then syncs its Pages. Nothing is stored when validation fails. */
export async function addProfile(userId: string, pasted: string): Promise<AddProfileResult> {
  let token = pasted;
  let info = await debugToken(token);
  if (!info.isValid) throw new PsUserError('Facebook reports this token as invalid or expired.');
  let tokenType = toTokenType(info.type);
  if (!tokenType) {
    throw new PsUserError(`Unsupported token type "${info.type}" — paste a User or System User access token (not a Page token).`);
  }
  const configuredApp = getConfiguredAppId();
  if (configuredApp && info.appId !== configuredApp) throw new PsUserError('Token not issued by this app.');

  const warnings: string[] = [];
  if (tokenType === 'USER') {
    if (getAppCredentials()) {
      token = await exchangeLongLived(token);
      info = await debugToken(token);
      tokenType = toTokenType(info.type) ?? 'USER';
    } else {
      warnings.push('FB_APP_ID/FB_APP_SECRET not configured — token stored as pasted and will expire; re-paste it before it does.');
    }
  }

  const scopes = await grantedScopes(token, info.scopes);
  const missing = REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
  if (missing.length) {
    throw new PsUserError(`Token is missing required permission(s): ${missing.join(', ')}. Regenerate it with all of: ${REQUIRED_SCOPES.join(', ')}.`);
  }
  const missingOptional = OPTIONAL_SCOPES.filter((s) => !scopes.includes(s));

  const me = await fbGet('/me', { fields: 'id,name' }, token, PAGE_SCHEDULER_FB_API_BASE) as { id?: string; name?: string };
  if (!me.id) throw new PsUserError('Could not read the token owner from Facebook.');

  const now = new Date().toISOString();
  const service = createServiceClient();
  const { data, error } = await service
    .from('ps_fb_profiles')
    .upsert({
      user_id: userId,
      fb_user_id: me.id,
      fb_user_name: me.name ?? '',
      token_enc: encryptToken(token, userId),
      token_type: tokenType,
      app_id: info.appId,
      expires_at: info.expiresAt,
      granted_scopes: scopes,
      status: 'active',
      last_error: null,
      updated_at: now,
    }, { onConflict: 'user_id,fb_user_id' })
    .select(PROFILE_PUBLIC_COLUMNS)
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Failed to save profile');
  const profile = data as unknown as PsProfile;

  const { data: enc } = await service.from('ps_fb_profiles').select('token_enc').eq('id', profile.id).single();
  const outcome = await syncProfile(userId, profile.id, (enc as { token_enc: string }).token_enc, tokenType);
  return { profile, missing_optional_scopes: missingOptional, warnings, ...outcome };
}

/** Re-pulls Pages for an existing profile (caller has already verified ownership). */
export async function resyncProfile(userId: string, profileId: string): Promise<ProfileSyncOutcome> {
  const service = createServiceClient();
  const { data } = await service
    .from('ps_fb_profiles')
    .select('token_enc, token_type')
    .eq('id', profileId)
    .eq('user_id', userId)
    .maybeSingle();
  const row = data as { token_enc: string; token_type: string } | null;
  if (!row) throw new PsUserError('Profile not found');
  return syncProfile(userId, profileId, row.token_enc, row.token_type);
}

/**
 * Deletes a profile (pages cascade) then re-syncs the user's remaining active profiles so Pages
 * that were deduped onto the removed profile re-attach to another one.
 */
export async function removeProfile(userId: string, profileId: string): Promise<void> {
  const service = createServiceClient();
  const { error } = await service.from('ps_fb_profiles').delete().eq('id', profileId).eq('user_id', userId);
  if (error) throw new Error(error.message);

  const { data } = await service
    .from('ps_fb_profiles')
    .select('id, token_enc, token_type')
    .eq('user_id', userId)
    .eq('status', 'active');
  for (const p of (data ?? []) as { id: string; token_enc: string; token_type: string }[]) {
    await syncProfile(userId, p.id, p.token_enc, p.token_type); // sequential; failures isolated per profile
  }
}

/**
 * Decrypts the page access token for (userId, pageId). Throws an actionable Error when the Page is
 * unknown/inactive or its profile token was invalidated (re-paste in Settings).
 */
export async function getPageToken(userId: string, pageId: string): Promise<string> {
  const service = createServiceClient();
  const { data } = await service
    .from('ps_pages')
    .select('page_token_enc, is_active, ps_fb_profiles(status)')
    .eq('user_id', userId)
    .eq('page_id', pageId)
    .maybeSingle();
  const row = data as unknown as {
    page_token_enc: string;
    is_active: boolean;
    ps_fb_profiles: { status: string } | { status: string }[] | null;
  } | null;
  if (!row) throw new Error(`Page ${pageId} is not connected — add its profile token in Settings`);
  if (!row.is_active) throw new Error(`Page ${pageId} is inactive — resync its profile in Settings`);
  const profile = Array.isArray(row.ps_fb_profiles) ? row.ps_fb_profiles[0] : row.ps_fb_profiles;
  if (profile?.status === 'invalid') throw new Error(`The profile token for Page ${pageId} is invalid — re-paste it in Settings`);
  return decryptToken(row.page_token_enc, userId);
}
