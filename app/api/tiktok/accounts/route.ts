/**
 * Per-user TikTok connection. Any authenticated role; every query is scoped to the
 * requester's user_id (never another user's rows, never token fields).
 *
 * GET   /api/tiktok/accounts  → {connected, connected_at, accounts} for the requester.
 * PATCH /api/tiktok/accounts  → {advertiser_id, is_selected} toggle (rejects is_selected=true
 *                                for non-USD — Plan 1 is USD-only), OR {action:'resync_names'},
 *                                OR {action:'disconnect'} (clears the requester's rows + connection).
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { getConnectionStatus, deleteConnection, getValidAccessToken, describeAuthError } from '@/lib/tiktok/tiktok-connection';
import { resyncUserAdvertiserNames } from '@/lib/tiktok/advertiser-sync';
import type { TiktokAdvertiserAccount } from '@/lib/types';

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const service = createServiceClient();
  const [status, accountsRes] = await Promise.all([
    getConnectionStatus(user.id),
    service.from('tiktok_ad_accounts').select('advertiser_id,name,currency,is_selected').eq('user_id', user.id),
  ]);

  return Response.json({
    connected: status.connected,
    connected_at: status.connected_at,
    accounts: (accountsRes.data ?? []) as TiktokAdvertiserAccount[],
  });
}

interface PatchBody {
  action?: 'disconnect' | 'resync_names';
  advertiser_id?: string;
  is_selected?: boolean;
}

/** Refreshes name/currency for the requester's advertisers with their stored token (no OAuth round-trip). */
async function handleResyncNames(userId: string): Promise<Response> {
  let token: string;
  try {
    token = await getValidAccessToken(userId);
  } catch (err) {
    const { status, message } = describeAuthError(err);
    return errorResponse(message, status);
  }

  try {
    return Response.json(await resyncUserAdvertiserNames(userId, token));
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Resync failed', 500);
  }
}

/**
 * Disconnects the requester's own connection. TikTok's Business API documents no token
 * revocation endpoint, so this only removes local records; the token stays valid at TikTok
 * until natural expiry (the Settings card says so).
 */
async function handleDisconnect(userId: string): Promise<Response> {
  const service = createServiceClient();
  // Rows deleted first: if this fails, the connection stays intact rather than orphaning rows.
  const { error } = await service.from('tiktok_ad_accounts').delete().eq('user_id', userId);
  if (error) return errorResponse(error.message, 500);
  try {
    await deleteConnection(userId);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Disconnect failed', 500);
  }
  return Response.json({ success: true, revoked_at_tiktok: false });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (body.action === 'disconnect') return handleDisconnect(user.id);
  if (body.action === 'resync_names') return handleResyncNames(user.id);

  if (typeof body.advertiser_id !== 'string' || typeof body.is_selected !== 'boolean') {
    return errorResponse('advertiser_id (string) and is_selected (boolean) required', 400);
  }

  const service = createServiceClient();

  const { data: account } = await service
    .from('tiktok_ad_accounts')
    .select('currency')
    .eq('advertiser_id', body.advertiser_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!account) return errorResponse('Advertiser account not found', 404);

  if (body.is_selected && (account as { currency: string }).currency !== 'USD') {
    return errorResponse('Only USD advertiser accounts can be selected in Plan 1 (no FX conversion built).', 400);
  }

  const { error } = await service
    .from('tiktok_ad_accounts')
    .update({ is_selected: body.is_selected })
    .eq('advertiser_id', body.advertiser_id)
    .eq('user_id', user.id);
  if (error) return errorResponse(error.message, 500);

  return Response.json({ success: true });
}
