/**
 * Fetches today's campaign data from Facebook Marketing API v21.
 * Retrieves campaign list with inline insights (spend, CPM, CPC etc).
 * Budget fields are converted from cents to USD automatically.
 * Paginates through all campaigns automatically.
 */

import { fbGet } from './fb-client';
import type { CampaignRow } from '@/lib/types';

const CAMPAIGN_FIELDS = [
  'id', 'name', 'status', 'effective_status',
  'daily_budget', 'lifetime_budget', 'budget_remaining',
  'promoted_object',
].join(',');

const INSIGHT_FIELDS = 'spend,impressions,clicks,cpm,cpc,ctr';

interface RawInsightRow {
  spend?: string;
  impressions?: string;
  clicks?: string;
  cpm?: string;
  cpc?: string;
  ctr?: string;
}

interface RawCampaign {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  budget_remaining?: string;
  promoted_object?: { application_id?: string };
  insights?: { data: RawInsightRow[] };
}

interface RawPageResponse {
  data: RawCampaign[];
  paging?: { cursors?: { after?: string }; next?: string };
}

function centsToUsd(val?: string): number | null {
  if (!val) return null;
  const n = parseInt(val, 10);
  return isNaN(n) || n === 0 ? null : n / 100;
}

function toFloat(val?: string): number {
  const n = parseFloat(val ?? '0');
  return isNaN(n) ? 0 : n;
}

function toInt(val?: string): number {
  const n = parseInt(val ?? '0', 10);
  return isNaN(n) ? 0 : n;
}

function resolveBudgetType(raw: RawCampaign): 'daily' | 'lifetime' | 'unknown' {
  if (raw.daily_budget && parseInt(raw.daily_budget, 10) > 0) return 'daily';
  if (raw.lifetime_budget && parseInt(raw.lifetime_budget, 10) > 0) return 'lifetime';
  return 'unknown';
}

function mapCampaign(raw: RawCampaign, accountId: string, accountName: string, currency: string): CampaignRow {
  const ins = raw.insights?.data?.[0];
  return {
    campaign_id: raw.id,
    campaign_name: raw.name,
    account_id: accountId,
    account_name: accountName,
    currency,
    status: raw.status,
    effective_status: raw.effective_status,
    daily_budget: centsToUsd(raw.daily_budget),
    lifetime_budget: centsToUsd(raw.lifetime_budget),
    budget_remaining: centsToUsd(raw.budget_remaining),
    budget_type: resolveBudgetType(raw),
    spend: toFloat(ins?.spend),
    impressions: toInt(ins?.impressions),
    clicks: toInt(ins?.clicks),
    cpm: toFloat(ins?.cpm),
    cpc: toFloat(ins?.cpc),
    ctr: toFloat(ins?.ctr),
    app_id: raw.promoted_object?.application_id ?? null,
    app_name: null, // resolved later via fetchAppNames
  };
}

/**
 * Batch-fetches app names for a set of app IDs using the FB Graph API.
 * Returns a map of app_id → app_name.
 */
export async function fetchAppNames(
  token: string,
  appIds: string[],
): Promise<Map<string, string>> {
  if (appIds.length === 0) return new Map();
  const ids = [...new Set(appIds)].join(',');
  type AppNode = { id: string; name?: string };
  type BatchResponse = Record<string, AppNode>;
  try {
    const res = await fbGet('/', { ids, fields: 'name' }, token) as BatchResponse;
    const map = new Map<string, string>();
    for (const [id, node] of Object.entries(res)) {
      if (node?.name) map.set(id, node.name);
    }
    return map;
  } catch {
    // Non-fatal: app name enrichment is best-effort
    return new Map();
  }
}

/**
 * Fetches all campaigns for the given ad account with today's insights.
 * Uses cursor-based pagination to retrieve all campaigns (not just first 100).
 */
export async function fetchCampaigns(
  token: string,
  adAccountId: string,
  accountName: string,
  currency: string = 'USD',
): Promise<CampaignRow[]> {
  const campaigns: CampaignRow[] = [];
  // Inline insights sub-request using today date preset
  const insightFields = `insights.date_preset(today){${INSIGHT_FIELDS}}`;
  let after: string | undefined;

  do {
    const params: Record<string, string> = {
      fields: `${CAMPAIGN_FIELDS},${insightFields}`,
      // Fetch active + paused campaigns (paused with spend today will be filtered client-side)
      filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED'] }]),
      limit: '100',
    };
    if (after) params.after = after;

    const page = await fbGet(`/${adAccountId}/campaigns`, params, token) as RawPageResponse;
    for (const raw of page.data ?? []) {
      campaigns.push(mapCampaign(raw, adAccountId, accountName, currency));
    }

    after = page.paging?.cursors?.after;
    if (!page.paging?.next) break;
  } while (after);

  // Only return campaigns that actually spent today
  return campaigns.filter((c) => c.spend > 0);
}
