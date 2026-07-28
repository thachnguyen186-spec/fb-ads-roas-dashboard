/**
 * GET  /api/account-owners  → every account the requester may manage (FB scoped by
 *      getVisibleUserIds, TikTok all), left-joined with any existing owner_label.
 * PATCH /api/account-owners → upsert an owner_label with a per-platform existence/scope
 *      check and an updated_by audit stamp. Admin/leader only — staff get 403.
 */
import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireRole, getUserRole, getVisibleUserIds } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';
import type { AccountOwnerEntry, UserRole } from '@/lib/types';

interface FbAccountRow { account_id: string; name: string; currency: string }
interface TtAccountRow { advertiser_id: string; name: string; currency: string }
interface OwnerRow { account_id: string; platform: 'facebook' | 'tiktok'; owner_label: string }

/** Wraps getVisibleUserIds so a transient listUsers failure returns a clean 502, not a raw 500. */
async function resolveVisibleIds(userId: string, role: UserRole): Promise<string[] | Response> {
  try {
    return await getVisibleUserIds(userId, role);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Failed to resolve visible accounts', 502);
  }
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin', 'leader']);
  if (denied) return denied;

  const role = ((await getUserRole(user.id)) ?? 'staff') as UserRole;
  const visibleIds = await resolveVisibleIds(user.id, role);
  if (visibleIds instanceof Response) return visibleIds;

  const service = createServiceClient();
  const [fbRes, ttRes, ownersRes] = await Promise.all([
    service.from('fb_ad_accounts').select('account_id,name,currency').in('user_id', visibleIds),
    service.from('tiktok_advertiser_accounts').select('advertiser_id,name,currency'),
    service.from('account_owners').select('account_id,platform,owner_label'),
  ]);

  const ownerMap = new Map<string, string>();
  for (const o of (ownersRes.data ?? []) as OwnerRow[]) {
    ownerMap.set(`${o.platform}:${o.account_id}`, o.owner_label);
  }

  // De-dupe FB accounts by account_id — the same account can belong to multiple visible users.
  const fbByAccount = new Map<string, FbAccountRow>();
  for (const a of (fbRes.data ?? []) as FbAccountRow[]) fbByAccount.set(a.account_id, a);

  const accounts: AccountOwnerEntry[] = [
    ...[...fbByAccount.values()].map((a) => ({
      account_id: a.account_id,
      platform: 'facebook' as const,
      account_name: a.name,
      currency: a.currency,
      owner_label: ownerMap.get(`facebook:${a.account_id}`) ?? '',
    })),
    ...((ttRes.data ?? []) as TtAccountRow[]).map((a) => ({
      account_id: a.advertiser_id,
      platform: 'tiktok' as const,
      account_name: a.name,
      currency: a.currency,
      owner_label: ownerMap.get(`tiktok:${a.advertiser_id}`) ?? '',
    })),
  ];

  return Response.json({ accounts });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin', 'leader']);
  if (denied) return denied;

  let body: { account_id?: string; platform?: string; owner_label?: string };
  try { body = await request.json(); } catch { return errorResponse('Invalid JSON body', 400); }

  const { account_id, platform, owner_label } = body;
  if (!account_id) return errorResponse('account_id required', 400);
  if (platform !== 'facebook' && platform !== 'tiktok') return errorResponse('platform must be facebook or tiktok', 400);
  if (typeof owner_label !== 'string') return errorResponse('owner_label must be a string', 400);

  const label = owner_label.trim().replace(/\s+/g, ' ').slice(0, 120);
  const service = createServiceClient();

  if (platform === 'facebook') {
    const role = ((await getUserRole(user.id)) ?? 'staff') as UserRole;
    const visibleIds = await resolveVisibleIds(user.id, role);
    if (visibleIds instanceof Response) return visibleIds;
    const { data } = await service
      .from('fb_ad_accounts')
      .select('account_id')
      .eq('account_id', account_id)
      .in('user_id', visibleIds)
      .limit(1);
    if (!data || data.length === 0) return errorResponse('Forbidden — account not in your visible set', 403);
  } else {
    const { data } = await service
      .from('tiktok_advertiser_accounts')
      .select('advertiser_id')
      .eq('advertiser_id', account_id)
      .limit(1);
    if (!data || data.length === 0) return errorResponse('TikTok advertiser not found', 404);
  }

  const { error } = await service
    .from('account_owners')
    .upsert(
      { account_id, platform, owner_label: label, updated_at: new Date().toISOString(), updated_by: user.id },
      { onConflict: 'account_id,platform' },
    );
  if (error) return errorResponse(error.message, 500);

  return Response.json({ ok: true });
}
