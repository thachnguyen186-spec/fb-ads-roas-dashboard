/**
 * GET  /api/account-owners  → every account the requester may manage (FB scoped by
 *      getVisibleUserIds, TikTok likewise via tiktok_ad_accounts), left-joined with any existing owner_label/department_label.
 * PATCH /api/account-owners → upserts owner_label and/or department_label with a per-platform
 *      existence/scope check and an updated_by audit stamp. Admin/leader only — staff get 403.
 *      Owner and department are independent fields: a client may send either or both keys;
 *      whichever is omitted keeps its current stored value (never blanked by a sibling edit).
 */
import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireRole, getUserRole, getVisibleUserIds } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';
import type { AccountOwnerEntry, UserRole } from '@/lib/types';

interface FbAccountRow { account_id: string; name: string; currency: string }
interface TtAccountRow { advertiser_id: string; name: string; currency: string }
interface OwnerRow { account_id: string; platform: 'facebook' | 'tiktok'; owner_label: string; department_label: string }

/** Trims, collapses internal whitespace, and caps length — same rule for owner and department labels. */
function normalizeLabel(val: string): string {
  return val.trim().replace(/\s+/g, ' ').slice(0, 120);
}

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
    service.from('tiktok_ad_accounts').select('advertiser_id,name,currency').in('user_id', visibleIds),
    service.from('account_owners').select('account_id,platform,owner_label,department_label'),
  ]);

  const ownerMap = new Map<string, { owner_label: string; department_label: string }>();
  for (const o of (ownersRes.data ?? []) as OwnerRow[]) {
    ownerMap.set(`${o.platform}:${o.account_id}`, { owner_label: o.owner_label, department_label: o.department_label });
  }

  // De-dupe FB accounts by account_id — the same account can belong to multiple visible users.
  const fbByAccount = new Map<string, FbAccountRow>();
  for (const a of (fbRes.data ?? []) as FbAccountRow[]) fbByAccount.set(a.account_id, a);

  // De-dupe TikTok advertisers — the same advertiser can be connected by multiple visible users.
  const ttByAdvertiser = new Map<string, TtAccountRow>();
  for (const a of (ttRes.data ?? []) as TtAccountRow[]) ttByAdvertiser.set(a.advertiser_id, a);

  const accounts: AccountOwnerEntry[] = [
    ...[...fbByAccount.values()].map((a) => ({
      account_id: a.account_id,
      platform: 'facebook' as const,
      account_name: a.name,
      currency: a.currency,
      owner_label: ownerMap.get(`facebook:${a.account_id}`)?.owner_label ?? '',
      department_label: ownerMap.get(`facebook:${a.account_id}`)?.department_label ?? '',
    })),
    ...[...ttByAdvertiser.values()].map((a) => ({
      account_id: a.advertiser_id,
      platform: 'tiktok' as const,
      account_name: a.name,
      currency: a.currency,
      owner_label: ownerMap.get(`tiktok:${a.advertiser_id}`)?.owner_label ?? '',
      department_label: ownerMap.get(`tiktok:${a.advertiser_id}`)?.department_label ?? '',
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

  let body: { account_id?: string; platform?: string; owner_label?: string; department_label?: string };
  try { body = await request.json(); } catch { return errorResponse('Invalid JSON body', 400); }

  const { account_id, platform } = body;
  if (!account_id) return errorResponse('account_id required', 400);
  if (platform !== 'facebook' && platform !== 'tiktok') return errorResponse('platform must be facebook or tiktok', 400);
  if (body.owner_label === undefined && body.department_label === undefined) {
    return errorResponse('owner_label or department_label required', 400);
  }
  if (body.owner_label !== undefined && typeof body.owner_label !== 'string') {
    return errorResponse('owner_label must be a string', 400);
  }
  if (body.department_label !== undefined && typeof body.department_label !== 'string') {
    return errorResponse('department_label must be a string', 400);
  }

  const service = createServiceClient();

  const role = ((await getUserRole(user.id)) ?? 'staff') as UserRole;
  const visibleIds = await resolveVisibleIds(user.id, role);
  if (visibleIds instanceof Response) return visibleIds;
  const scoped = platform === 'facebook'
    ? service.from('fb_ad_accounts').select('account_id').eq('account_id', account_id).in('user_id', visibleIds).limit(1)
    : service.from('tiktok_ad_accounts').select('advertiser_id').eq('advertiser_id', account_id).in('user_id', visibleIds).limit(1);
  const { data } = await scoped;
  if (!data || data.length === 0) return errorResponse('Forbidden — account not in your visible set', 403);

  // Atomic partial upsert via RPC — NULL means "leave untouched." A plain select-then-upsert
  // here would have a TOCTOU race between the two independent per-field PATCH calls the UI
  // fires (grouping-manager.tsx commits Owner and Department on separate blur events), and
  // would fail open into silent data loss if the read itself errored. See schema.sql.
  const { data: rpcData, error } = await service.rpc('upsert_account_owner_label', {
    p_account_id: account_id,
    p_platform: platform,
    p_owner_label: body.owner_label !== undefined ? normalizeLabel(body.owner_label) : null,
    p_department_label: body.department_label !== undefined ? normalizeLabel(body.department_label) : null,
    p_updated_by: user.id,
  });
  if (error) return errorResponse(error.message, 500);

  const result = (rpcData as { owner_label: string; department_label: string }[] | null)?.[0];
  if (!result) return errorResponse('Upsert failed', 500);

  return Response.json({ ok: true, owner_label: result.owner_label, department_label: result.department_label });
}
