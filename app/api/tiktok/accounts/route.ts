/**
 * GET   /api/tiktok/accounts  → connection status ({connected, connected_at}, never token
 *                                fields) + advertiser account list. admin|leader.
 * PATCH /api/tiktok/accounts  → {advertiser_id, is_selected} toggle (admin|leader, rejects
 *                                is_selected=true for non-USD — Plan 1 is USD-only) OR
 *                                {action:'disconnect'} (admin-only, always clears both tables).
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';
import { getConnectionStatus, deleteConnection, getValidAccessToken, describeAuthError } from '@/lib/tiktok/tiktok-connection';
import { fetchAdvertiserInfo } from '@/lib/tiktok/advertiser-info';
import type { TiktokAdvertiserAccount } from '@/lib/types';

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin', 'leader']);
  if (denied) return denied;

  const service = createServiceClient();
  const [status, accountsRes] = await Promise.all([
    getConnectionStatus(),
    service.from('tiktok_advertiser_accounts').select('advertiser_id,name,currency,is_selected'),
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

/**
 * Refreshes name/currency for every already-connected advertiser using the stored org token —
 * no OAuth round-trip. Exists because a past chunking bug (fixed in the sync path) left many
 * advertiser rows with name == advertiser_id baked in; this lets an admin/leader correct that
 * without disconnecting, which would also wipe every is_selected choice.
 */
async function handleResyncNames(): Promise<Response> {
  let token: string;
  try {
    token = await getValidAccessToken();
  } catch (err) {
    const { status, message } = describeAuthError(err);
    return errorResponse(message, status);
  }

  const service = createServiceClient();
  const { data } = await service.from('tiktok_advertiser_accounts').select('advertiser_id');
  const ids = ((data ?? []) as { advertiser_id: string }[]).map((r) => r.advertiser_id);
  if (ids.length === 0) return Response.json({ updated: 0 });

  const infoMap = await fetchAdvertiserInfo(ids, token);
  const rows = ids.map((id) => ({
    advertiser_id: id,
    name: infoMap.get(id)?.name ?? id,
    currency: infoMap.get(id)?.currency ?? 'USD',
  }));
  // is_selected intentionally omitted — existing rows keep their current selection, same
  // upsert shape as syncAdvertiserAccounts() in the OAuth callback.
  const { error } = await service.from('tiktok_advertiser_accounts').upsert(rows, { onConflict: 'advertiser_id' });
  if (error) return errorResponse(error.message, 500);

  return Response.json({ updated: rows.length });
}

/**
 * Disconnects the org-wide connection. TikTok's Business API does not document a token
 * revocation/deauthorization endpoint (research report §1/§2 — none found), so this only
 * removes the local record; the UI text on the Settings card must say the token stays
 * valid at TikTok until natural expiry (see tiktok-connection-card.tsx).
 */
async function handleDisconnect(): Promise<Response> {
  const service = createServiceClient();
  // Advertiser rows deleted first: if this step fails, the connection stays intact ("still
  // connected") rather than landing on the more confusing "disconnected but rows orphaned".
  const { error } = await service.from('tiktok_advertiser_accounts').delete().neq('advertiser_id', '');
  if (error) return errorResponse(error.message, 500);
  await deleteConnection();
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

  if (body.action === 'disconnect') {
    const denied = await requireRole(user.id, ['admin']);
    if (denied) return denied;
    return handleDisconnect();
  }

  const denied = await requireRole(user.id, ['admin', 'leader']);
  if (denied) return denied;

  if (body.action === 'resync_names') {
    return handleResyncNames();
  }

  if (typeof body.advertiser_id !== 'string' || typeof body.is_selected !== 'boolean') {
    return errorResponse('advertiser_id (string) and is_selected (boolean) required', 400);
  }

  const service = createServiceClient();

  const { data: account } = await service
    .from('tiktok_advertiser_accounts')
    .select('currency')
    .eq('advertiser_id', body.advertiser_id)
    .maybeSingle();
  if (!account) return errorResponse('Advertiser account not found', 404);

  if (body.is_selected && (account as { currency: string }).currency !== 'USD') {
    return errorResponse('Only USD advertiser accounts can be selected in Plan 1 (no FX conversion built).', 400);
  }

  const { error } = await service
    .from('tiktok_advertiser_accounts')
    .update({ is_selected: body.is_selected })
    .eq('advertiser_id', body.advertiser_id);
  if (error) return errorResponse(error.message, 500);

  return Response.json({ success: true });
}
