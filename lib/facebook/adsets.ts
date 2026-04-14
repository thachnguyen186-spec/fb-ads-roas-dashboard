/**
 * Fetches active ad sets for a campaign from FB Marketing API v21.
 * Retrieves ad set list with inline today's insights.
 * Budget fields converted from cents to USD automatically.
 * Paginates through all ad sets automatically.
 */

import { fbGet } from './fb-client';
import type { AdSetRow } from '@/lib/types';

const ADSET_FIELDS = [
  'id', 'name', 'status', 'effective_status',
  'daily_budget', 'lifetime_budget', 'budget_remaining',
].join(',');

const INSIGHT_FIELDS = 'spend,impressions,clicks,cpm,cpc';

interface RawInsightRow {
  spend?: string;
  impressions?: string;
  clicks?: string;
  cpm?: string;
  cpc?: string;
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
    cpm: toFloat(ins?.cpm),
    cpc: toFloat(ins?.cpc),
  };
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
      filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]),
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

  return adsets;
}
