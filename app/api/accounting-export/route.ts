/**
 * GET /api/accounting-export?since=&until=&datePreset=&platform=facebook|tiktok|both
 * Admin/leader only. Fans out across the requester's visible FB accounts and (if requested)
 * every TikTok advertiser, resolves spend + target labels in native currency, left-joins
 * account_owners, and returns { rows, warnings, coverage, partial?, leg_aborted? }.
 *
 * Vercel tier unconfirmed at implementation time — maxDuration is a no-op on Hobby's hard
 * 10s cap and only effective on Pro. Parallelization below (concurrent legs, bounded batches,
 * minimized per-account serial chain) is treated as load-bearing either way, not just a bonus.
 */
import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireRole, getUserRole, getVisibleUserIds } from '@/lib/auth-guards';
import { errorResponse, chunk } from '@/lib/utils';
import { resolveDateParam } from '@/app/api/campaigns/route';
import { fetchCampaigns as fetchFbCampaigns, fetchAppNames, type InsightDateParam } from '@/lib/facebook/campaigns';
import { fetchCampaignAppIds } from '@/lib/facebook/campaign-app-map';
import { fetchCampaignDestinations } from '@/lib/facebook/campaign-destination';
import { fetchCampaigns as fetchTiktokCampaigns } from '@/lib/tiktok/campaigns';
import { fetchSpend } from '@/lib/tiktok/reporting';
import { fetchCampaignTargets } from '@/lib/tiktok/campaign-target';
import { getValidAccessToken, describeAuthError } from '@/lib/tiktok/tiktok-connection';
import { buildFbRows, buildTiktokRows, presetToRange, type OwnerLabels } from '@/lib/accounting/build-rows';
import type { AccountingExportRow, UserRole } from '@/lib/types';

export const maxDuration = 60;

const CONCURRENCY = 3;
const COOLDOWN_MS = 10_000;
const MAX_CONSECUTIVE_FAILS = 5;
const ROW_CEILING = 5000;
const lastExportAt = new Map<string, number>(); // per-user cooldown, module-level (single-instance best-effort)

interface LegResult { rows: AccountingExportRow[]; warnings: string[]; partial: boolean }

/** Runs `worker` over `items` in batches of CONCURRENCY; aborts the leg after 5 consecutive failures. */
async function runBatched<T>(items: T[], worker: (item: T) => Promise<void>, warnings: string[]): Promise<boolean> {
  let consecutiveFails = 0;
  for (const batch of chunk(items, CONCURRENCY)) {
    const results = await Promise.allSettled(batch.map(worker));
    for (const r of results) {
      if (r.status === 'rejected') {
        warnings.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
        consecutiveFails += 1;
      } else {
        consecutiveFails = 0;
      }
    }
    if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) return true; // leg aborted
  }
  return false;
}

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

async function tiktokLeg(dateParam: InsightDateParam, ownerMap: Map<string, OwnerLabels>): Promise<LegResult> {
  const rows: AccountingExportRow[] = [];
  const warnings: string[] = [];

  let token: string;
  try {
    token = await getValidAccessToken();
  } catch (err) {
    warnings.push(`tiktok: ${describeAuthError(err).message}`);
    return { rows, warnings, partial: false };
  }

  const service = createServiceClient();
  const { data, error: advertisersError } = await service.from('tiktok_advertiser_accounts').select('advertiser_id, name, currency');
  if (advertisersError) warnings.push(`tiktok: failed to load advertiser accounts — ${advertisersError.message}`);
  const advertisers = (data ?? []) as { advertiser_id: string; name: string; currency: string }[];

  const range = presetToRange(dateParam);
  if ('preset' in dateParam && dateParam.preset === 'maximum') {
    warnings.push("tiktok: 'maximum' capped at 1 year — TikTok's Reporting API has no open-ended range");
  }

  const partial = await runBatched(advertisers, async (adv) => {
    try {
      const [campaigns, spendMap, targetMap] = await Promise.all([
        fetchTiktokCampaigns(token, adv.advertiser_id, adv.name, adv.currency),
        fetchSpend(token, adv.advertiser_id, 'CAMPAIGN', range),
        fetchCampaignTargets(token, adv.advertiser_id),
      ]);
      rows.push(...buildTiktokRows(campaigns, spendMap, targetMap, ownerMap, adv.advertiser_id, adv.name, adv.currency));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`tiktok ${adv.advertiser_id}: ${message}`);
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
    wantTiktok ? tiktokLeg(dateParam, ownerMap) : Promise.resolve(empty),
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
