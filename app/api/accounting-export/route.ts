/**
 * GET /api/accounting-export?since=&until=&datePreset=&platform=facebook|tiktok|both
 * Admin/leader only. Fans out across the requester's visible FB accounts and (if requested)
 * TikTok advertisers connected by visible users (deduped, fetched with an owner's token), resolves spend + target labels in native currency, left-joins
 * account_owners, and returns { rows, warnings, coverage, partial?, leg_aborted? }.
 *
 * Vercel tier unconfirmed at implementation time — maxDuration is a no-op on Hobby's hard
 * 10s cap and only effective on Pro. Parallelization below (concurrent legs, bounded batches,
 * minimized per-account serial chain) is treated as load-bearing either way, not just a bonus.
 */
import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireRole, getUserRole, getVisibleUserIds } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';
import { resolveDateParam } from '@/app/api/campaigns/route';
import { fetchCampaigns as fetchFbCampaigns, fetchAppNames, type InsightDateParam } from '@/lib/facebook/campaigns';
import { fetchCampaignAppIds } from '@/lib/facebook/campaign-app-map';
import { fetchCampaignDestinations } from '@/lib/facebook/campaign-destination';
import { buildFbRows, type OwnerLabels } from '@/lib/accounting/build-rows';
import { runBatched, type LegResult } from '@/lib/accounting/run-batched';
import { tiktokLeg } from '@/lib/accounting/tiktok-export-leg';
import type { AccountingExportRow, UserRole } from '@/lib/types';

export const maxDuration = 60;

const COOLDOWN_MS = 10_000;
const ROW_CEILING = 5000;
const lastExportAt = new Map<string, number>(); // per-user cooldown, module-level (single-instance best-effort)

async function fbLeg(visibleIds: string[], dateParam: InsightDateParam, ownerMap: Map<string, OwnerLabels>): Promise<LegResult> {
  const rows: AccountingExportRow[] = [];
  const warnings: string[] = [];
  const service = createServiceClient();

  const [profilesRes, accountsRes] = await Promise.all([
    service.from('profiles').select('id, fb_access_token').in('id', visibleIds),
    service.from('fb_ad_accounts').select('account_id, user_id, name, currency').in('user_id', visibleIds),
  ]);
  if (profilesRes.error) warnings.push(`facebook: failed to load tokens — ${profilesRes.error.message}`);
  if (accountsRes.error) warnings.push(`facebook: failed to load accounts — ${accountsRes.error.message}`);

  const tokenByUser = new Map<string, string>();
  for (const p of (profilesRes.data ?? []) as { id: string; fb_access_token: string | null }[]) {
    if (p.fb_access_token) tokenByUser.set(p.id, p.fb_access_token);
  }
  const accounts = (accountsRes.data ?? []) as { account_id: string; user_id: string; name: string; currency: string }[];
  const jobs = accounts.filter((a) => tokenByUser.has(a.user_id));

  const partial = await runBatched(jobs, async (account) => {
    const token = tokenByUser.get(account.user_id)!;
    try {
      const [campaigns, appIdMap] = await Promise.all([
        fetchFbCampaigns(token, account.account_id, account.name, account.currency, dateParam, true),
        fetchCampaignAppIds(token, account.account_id),
      ]);
      const appless = campaigns.filter((c) => !(appIdMap.get(c.campaign_id) ?? c.app_id));
      const [domainMap, appNameMap] = await Promise.all([
        appless.length ? fetchCampaignDestinations(token, account.account_id) : Promise.resolve(new Map<string, string>()),
        fetchAppNames(token, [...appIdMap.values()]),
      ]);
      rows.push(...buildFbRows(campaigns, appIdMap, appNameMap, domainMap, ownerMap));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`facebook ${account.account_id}: ${message}`);
    }
  }, warnings);

  return { rows, warnings, partial };
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin', 'leader']);
  if (denied) return denied;

  const now = Date.now();
  if (now - (lastExportAt.get(user.id) ?? 0) < COOLDOWN_MS) {
    return errorResponse('Please wait a few seconds before exporting again', 429);
  }
  lastExportAt.set(user.id, now);

  const role = ((await getUserRole(user.id)) ?? 'staff') as UserRole;
  const dateParam = resolveDateParam(request.nextUrl.searchParams);
  if (dateParam instanceof Response) return dateParam;

  const platform = request.nextUrl.searchParams.get('platform') ?? 'both';
  const wantFb = platform === 'facebook' || platform === 'both';
  const wantTiktok = platform === 'tiktok' || platform === 'both';

  const service = createServiceClient();

  let visibleIds: string[];
  try {
    visibleIds = await getVisibleUserIds(user.id, role);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Failed to resolve visible accounts', 502);
  }

  let coverage: { role: UserRole; visibleUserCount?: number; totalOrgUserCount?: number } = { role };
  if (role === 'admin') {
    const { count } = await service.from('profiles').select('id', { count: 'exact', head: true });
    coverage = { role, visibleUserCount: visibleIds.length, totalOrgUserCount: count ?? visibleIds.length };
  }

  const { data: ownerRows } = await service.from('account_owners').select('account_id, platform, owner_label, department_label');
  const ownerMap = new Map<string, OwnerLabels>();
  for (const o of (ownerRows ?? []) as { account_id: string; platform: string; owner_label: string; department_label: string }[]) {
    ownerMap.set(`${o.platform}:${o.account_id}`, { owner_label: o.owner_label, department_label: o.department_label });
  }

  const empty: LegResult = { rows: [], warnings: [], partial: false };
  const [fbResult, ttResult] = await Promise.all([
    wantFb ? fbLeg(visibleIds, dateParam, ownerMap) : Promise.resolve(empty),
    wantTiktok ? tiktokLeg(visibleIds, dateParam, ownerMap) : Promise.resolve(empty),
  ]);

  let rows = [...fbResult.rows, ...ttResult.rows];
  const warnings = [...fbResult.warnings, ...ttResult.warnings];
  if (rows.length > ROW_CEILING) {
    rows = rows.slice(0, ROW_CEILING);
    warnings.push(`Result truncated at ${ROW_CEILING} rows — narrow your date range or filters`);
  }

  const legAborted: string[] = [];
  if (fbResult.partial) legAborted.push('facebook');
  if (ttResult.partial) legAborted.push('tiktok');

  return Response.json({
    rows,
    warnings,
    coverage,
    ...(legAborted.length ? { partial: true, leg_aborted: legAborted } : {}),
  });
}
