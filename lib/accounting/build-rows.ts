/**
 * Row assembly for the Accounting Export route — kept out of route.ts to stay under
 * the 200-line file-size guideline. Pure functions, no I/O.
 */
import type { CampaignRow, TiktokCampaignRow, AccountingExportRow } from '@/lib/types';
import type { InsightDateParam } from '@/lib/facebook/campaigns';
import type { TiktokSpendMetrics } from '@/lib/tiktok/reporting';
import type { CampaignTarget } from '@/lib/tiktok/campaign-target';

/** FB rows: app_id → app name (fallback app_id) → 'app'; else resolved domain → 'website'; else 'unknown'. */
export function buildFbRows(
  campaigns: CampaignRow[],
  appIdMap: Map<string, string>,
  appNameMap: Map<string, string>,
  domainMap: Map<string, string>,
  ownerMap: Map<string, string>,
): AccountingExportRow[] {
  return campaigns.map((c) => {
    const appId = appIdMap.get(c.campaign_id) ?? c.app_id ?? null;
    let target_type: AccountingExportRow['target_type'] = 'unknown';
    let target_label = 'Unknown';
    if (appId) {
      target_type = 'app';
      target_label = appNameMap.get(appId) ?? appId;
    } else {
      const domain = domainMap.get(c.campaign_id);
      if (domain) {
        target_type = 'website';
        target_label = domain;
      }
    }
    return {
      platform: 'facebook',
      account_id: c.account_id,
      account_name: c.account_name,
      campaign_id: c.campaign_id,
      campaign_name: c.campaign_name,
      currency: c.currency,
      spend: c.spend,
      target_type,
      target_label,
      owner_label: ownerMap.get(`facebook:${c.account_id}`) ?? '',
    };
  });
}

/**
 * TikTok rows: iterates the UNION of the campaign list and the spend-map keys (Red Team Fix #4)
 * so a campaign with Reporting spend but excluded from /campaign/get/ (e.g. archived) still
 * appears — using its raw campaign_id as the name when metadata is missing. Only spenders are
 * included (mirrors FB's spend > 0 filter).
 */
export function buildTiktokRows(
  campaigns: TiktokCampaignRow[],
  spendMap: Map<string, TiktokSpendMetrics>,
  targetMap: Map<string, CampaignTarget>,
  ownerMap: Map<string, string>,
  accountId: string,
  accountName: string,
  currency: string,
): AccountingExportRow[] {
  const byId = new Map(campaigns.map((c) => [c.campaign_id, c]));
  const allIds = new Set([...byId.keys(), ...spendMap.keys()]);
  const owner = ownerMap.get(`tiktok:${accountId}`) ?? '';
  const rows: AccountingExportRow[] = [];

  for (const cid of allIds) {
    const campaign = byId.get(cid);
    const spend = spendMap.get(cid)?.spend ?? campaign?.spend ?? 0;
    if (spend <= 0) continue;
    const target = targetMap.get(cid);
    rows.push({
      platform: 'tiktok',
      account_id: accountId,
      account_name: accountName,
      campaign_id: cid,
      campaign_name: campaign?.campaign_name ?? cid,
      currency,
      spend,
      target_type: target?.target_type ?? 'unknown',
      target_label: target?.target_label ?? 'Unknown',
      owner_label: owner,
    });
  }
  return rows;
}

function pad(n: number): string { return String(n).padStart(2, '0'); }
function toDateStr(d: Date): string { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r; }

/**
 * Resolves an FB-style InsightDateParam to concrete UTC dates for TikTok's Reporting API
 * (which has no date_preset concept). 'maximum' has no open-ended equivalent on TikTok —
 * capped at 1 year back (Red Team Fix #10, user-confirmed); FB still gets true 'maximum'.
 */
export function presetToRange(dateParam: InsightDateParam): { since: string; until: string } {
  if ('since' in dateParam) return { since: dateParam.since, until: dateParam.until };

  const today = new Date();
  const todayStr = toDateStr(today);
  switch (dateParam.preset) {
    case 'today': return { since: todayStr, until: todayStr };
    case 'yesterday': { const y = toDateStr(addDays(today, -1)); return { since: y, until: y }; }
    case 'last_7d': return { since: toDateStr(addDays(today, -6)), until: todayStr };
    case 'last_14d': return { since: toDateStr(addDays(today, -13)), until: todayStr };
    case 'last_30d': return { since: toDateStr(addDays(today, -29)), until: todayStr };
    case 'this_month': return { since: toDateStr(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), until: todayStr };
    case 'last_month': {
      const firstThisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      const lastPrevMonth = addDays(firstThisMonth, -1);
      const firstPrevMonth = new Date(Date.UTC(lastPrevMonth.getUTCFullYear(), lastPrevMonth.getUTCMonth(), 1));
      return { since: toDateStr(firstPrevMonth), until: toDateStr(lastPrevMonth) };
    }
    case 'maximum': {
      const oneYearAgo = new Date(today);
      oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
      return { since: toDateStr(oneYearAgo), until: todayStr };
    }
    default: return { since: todayStr, until: todayStr };
  }
}
