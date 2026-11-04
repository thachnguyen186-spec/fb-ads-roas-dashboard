/**
 * Resolves FB ad IDs (from an AppsFlyer "by Ad ID" export) to their campaign + ad set.
 *
 * Source: ad-level insights per selected ad account, asked only for the IDs still unresolved
 * (`ad.id IN` chunks of 50) across every effective status. Deleted, archived and paused ads can
 * still earn AppsFlyer revenue today ("revenue activity days" includes users acquired earlier),
 * and an ad may not have delivered for days, so the window is the last 30 days including today.
 * "Today" is the account's own calendar day (same day FB's `date_preset=today` uses for the
 * campaign list), so the window never runs past the account's current date.
 *
 * If Graph rejects that filtering as an invalid parameter (code 100), that account falls back to
 * paging every ad that delivered in the last 7 days. IDs resolved under one account are dropped
 * from later queries and the scan stops once nothing is pending.
 *
 * Per-account failures never fail the whole map: they become human-readable warnings.
 */

import { fbGet, FbApiError } from './fb-client';

export interface AdPlacementAccount {
  account_id: string; // "act_…"
  name: string;
}

export interface AdPlacementsResult {
  placements: Record<string, { campaign_id: string; adset_id: string }>;
  warnings: string[];
}

interface RawInsightRow {
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
}

interface RawInsightPage {
  data?: RawInsightRow[];
  paging?: { cursors?: { after?: string }; next?: string };
}

const FALLBACK_TIMEZONE = 'Asia/Bangkok';
const FILTERED_LOOKBACK_DAYS = 29; // today + 29 previous days = 30 days
const UNFILTERED_LOOKBACK_DAYS = 6; // today + 6 previous days = 7 days
const ID_CHUNK = 50;
const PAGE_SIZE = '500';
const MAX_PAGES_PER_QUERY = 60; // 30k ads — guards against a runaway paging loop
const ACCOUNT_CONCURRENCY = 4;
const FIELDS = 'ad_id,adset_id,campaign_id';
const INVALID_PARAMETER_CODE = 100;
const TOKEN_EXPIRED_MSG = 'Facebook token expired — re-paste it in Settings.';
const CUT_SHORT_MSG = `stopped after ${MAX_PAGES_PER_QUERY} pages of ads; some ads may be unmatched.`;
/** Every ad effective status, so deleted/archived/paused ads are not left out of the breakdown. */
const ALL_EFFECTIVE_STATUSES = [
  'ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'IN_PROCESS',
  'WITH_ISSUES', 'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED', 'PENDING_BILLING_INFO',
];

type Placements = AdPlacementsResult['placements'];

/** YYYY-MM-DD of `now` in `timeZone`, falling back to Asia/Bangkok for unknown zone names. */
function localDate(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: FALLBACK_TIMEZONE }).format(now);
  }
}

/** Shifts a YYYY-MM-DD calendar date by `days` (pure calendar math, no timezone involved). */
export function shiftDate(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Window of `lookbackDays` previous days plus the account's current calendar day. */
export function lookbackRange(now: Date, timeZone: string, lookbackDays: number): { since: string; until: string } {
  const until = localDate(now, timeZone);
  return { since: shiftDate(until, -lookbackDays), until };
}

function describeError(err: unknown): string {
  if (err instanceof FbApiError && err.code === 190) return TOKEN_EXPIRED_MSG;
  return err instanceof Error ? err.message : 'Unknown Facebook error';
}

async function fetchAccountTimezone(token: string, accountId: string): Promise<string> {
  const res = await fbGet(`/${accountId}`, { fields: 'timezone_name' }, token) as { timezone_name?: string };
  return res.timezone_name || FALLBACK_TIMEZONE;
}

/**
 * Pages one ad-level insights query, moving every pending ad it returns from `pending` to `out`.
 * Returns false when the page cap was hit before the last page.
 */
async function pageInsights(
  token: string,
  accountId: string,
  params: Record<string, string>,
  pending: Set<string>,
  out: Placements,
): Promise<boolean> {
  let after: string | undefined;
  for (let pageNo = 0; pageNo < MAX_PAGES_PER_QUERY; pageNo++) {
    const query = after ? { ...params, after } : params;
    const page = await fbGet(`/${accountId}/insights`, query, token) as RawInsightPage;
    for (const row of page.data ?? []) {
      if (!row.ad_id || !row.campaign_id || !pending.has(row.ad_id)) continue;
      out[row.ad_id] = { campaign_id: row.campaign_id, adset_id: row.adset_id ?? '' };
      pending.delete(row.ad_id);
    }
    after = page.paging?.cursors?.after;
    if (!page.paging?.next || !after || pending.size === 0) return true;
  }
  return false;
}

/** Asks the account only for the still-pending IDs, in chunks, across every effective status. */
async function collectFiltered(token: string, accountId: string, timeZone: string, pending: Set<string>, out: Placements): Promise<string | null> {
  const timeRange = JSON.stringify(lookbackRange(new Date(), timeZone, FILTERED_LOOKBACK_DAYS));
  const ids = [...pending];
  let cutShort = false;
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    // Other accounts run concurrently and may have resolved part of this chunk meanwhile.
    const chunk = ids.slice(i, i + ID_CHUNK).filter((id) => pending.has(id));
    if (chunk.length === 0) continue;
    const filtering = JSON.stringify([
      { field: 'ad.id', operator: 'IN', value: chunk },
      { field: 'ad.effective_status', operator: 'IN', value: ALL_EFFECTIVE_STATUSES },
    ]);
    const params = { level: 'ad', fields: FIELDS, time_range: timeRange, filtering, limit: PAGE_SIZE };
    if (!await pageInsights(token, accountId, params, pending, out)) cutShort = true;
  }
  return cutShort ? CUT_SHORT_MSG : null;
}

/** Pages every ad that delivered in the last 7 days (no filtering). */
async function collectUnfiltered(token: string, accountId: string, timeZone: string, pending: Set<string>, out: Placements): Promise<string | null> {
  const timeRange = JSON.stringify(lookbackRange(new Date(), timeZone, UNFILTERED_LOOKBACK_DAYS));
  const params = { level: 'ad', fields: FIELDS, time_range: timeRange, limit: PAGE_SIZE };
  return await pageInsights(token, accountId, params, pending, out) ? null : CUT_SHORT_MSG;
}

/** Resolves pending ads of one account into `out`. Returns a warning when paging was cut short. */
async function collectAccountPlacements(token: string, accountId: string, pending: Set<string>, out: Placements): Promise<string | null> {
  const timeZone = await fetchAccountTimezone(token, accountId);
  try {
    return await collectFiltered(token, accountId, timeZone, pending, out);
  } catch (err) {
    if (!(err instanceof FbApiError && err.code === INVALID_PARAMETER_CODE)) throw err;
    // Graph rejected the ad.id / effective_status filtering for this account — use plain paging.
    return await collectUnfiltered(token, accountId, timeZone, pending, out);
  }
}

/** Runs `worker` over `items` with at most `limit` in flight. */
async function forEachBounded<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

export async function fetchAdPlacements(
  token: string,
  accounts: AdPlacementAccount[],
  adIds: string[],
): Promise<AdPlacementsResult> {
  const pending = new Set(adIds);
  const placements: Placements = {};
  const warnings = new Set<string>();
  if (pending.size === 0) return { placements, warnings: [] };

  await forEachBounded(accounts, ACCOUNT_CONCURRENCY, async (account) => {
    if (pending.size === 0) return;
    try {
      const cutShort = await collectAccountPlacements(token, account.account_id, pending, placements);
      if (cutShort) warnings.add(`${account.name}: ${cutShort}`);
    } catch (err) {
      const msg = describeError(err);
      // An expired token fails every account identically — report it once, not per account.
      warnings.add(msg === TOKEN_EXPIRED_MSG ? msg : `${account.name}: ${msg}`);
    }
  });

  return { placements, warnings: [...warnings] };
}
