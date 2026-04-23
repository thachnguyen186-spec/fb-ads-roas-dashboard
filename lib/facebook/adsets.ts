/**
 * Fetches active ad sets for a campaign from FB Marketing API v21.
 * Retrieves ad set list with inline today's insights.
 * Budget fields converted from cents to USD automatically.
 * Paginates through all ad sets automatically.
 */

import { fbGet } from './fb-client';
import type { AdSetRow } from '@/lib/types';
import { extractCpi, type ActionCostEntry } from './cost-per-install';

const ADSET_FIELDS = [
  'id', 'name', 'status', 'effective_status',
  'daily_budget', 'lifetime_budget', 'budget_remaining',
].join(',');

const INSIGHT_FIELDS = 'spend,impressions,clicks,cpc,cost_per_action_type';

interface RawInsightRow {
  spend?: string;
  impressions?: string;
  clicks?: string;
  cpc?: string;
  cost_per_action_type?: ActionCostEntry[];
}

interface RawAdSet {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  budget_remaining?: string;
  insights?: { data: RawInsightRow[] };
}

interface RawPageResponse {
  data: RawAdSet[];
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

function resolveBudgetType(raw: RawAdSet): 'daily' | 'lifetime' | 'cbo' {
  if (raw.daily_budget && parseInt(raw.daily_budget, 10) > 0) return 'daily';
  if (raw.lifetime_budget && parseInt(raw.lifetime_budget, 10) > 0) return 'lifetime';
  return 'cbo'; // Campaign Budget Optimization — no individual ad set budget
}

function mapAdSet(
  raw: RawAdSet,
  campaignId: string,
  accountId: string,
  accountName: string,
  currency: string,
): AdSetRow {
  const ins = raw.insights?.data?.[0];
  return {
    adset_id: raw.id,
    adset_name: raw.name,
    campaign_id: campaignId,
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
    cpc: toFloat(ins?.cpc),
    cpi: extractCpi(ins?.cost_per_action_type),
  };
}

export interface AdSetBudgetInfo {
  id: string;
  name: string;
  daily_budget: number | null;
  lifetime_budget: number | null;
  budget_type: 'daily' | 'lifetime' | 'cbo';
}

/**
 * Lightweight adset fetch for the duplicate modal — no spend filter, no insights.
 * Returns budget info so the user can pre-fill budget inputs.
 */
export async function fetchAdSetsForDuplicate(
  token: string,
  campaignId: string,
): Promise<AdSetBudgetInfo[]> {
  const res = await fbGet(`/${campaignId}/adsets`, {
    fields: 'id,name,daily_budget,lifetime_budget',
    limit: '200',
  }, token) as { data: Array<{ id: string; name: string; daily_budget?: string; lifetime_budget?: string }> };

  return (res.data ?? []).map((raw) => ({
    id: raw.id,
    name: raw.name,
    daily_budget: centsToUsd(raw.daily_budget),
    lifetime_budget: centsToUsd(raw.lifetime_budget),
    budget_type: resolveBudgetType(raw as unknown as RawAdSet),
  }));
}

/**
 * Fetches all active ad sets for a campaign with today's insights.
 * Uses cursor-based pagination to retrieve all ad sets.
 */
export async function fetchAdSets(
  token: string,
  campaignId: string,
  accountId: string,
  accountName: string,
  currency: string = 'USD',
): Promise<AdSetRow[]> {
  const adsets: AdSetRow[] = [];
  const insightFields = `insights.date_preset(today){${INSIGHT_FIELDS}}`;
  let after: string | undefined;

  do {
    const params: Record<string, string> = {
      fields: `${ADSET_FIELDS},${insightFields}`,
      // Include paused adsets and campaign-paused adsets — they may still have spend if paused mid-day
      filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED'] }]),
      limit: '100',
    };
    if (after) params.after = after;

    const page = await fbGet(`/${campaignId}/adsets`, params, token) as RawPageResponse;
    for (const raw of page.data ?? []) {
      adsets.push(mapAdSet(raw, campaignId, accountId, accountName, currency));
    }

    after = page.paging?.cursors?.after;
    if (!page.paging?.next) break;
  } while (after);

  // Only return adsets that actually spent today
  return adsets.filter((a) => a.spend > 0);
}
