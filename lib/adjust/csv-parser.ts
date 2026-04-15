/**
 * Parses Adjust CSV exports using the known fixed schema:
 *   app, channel, campaign_network, campaign_id_network,
 *   adgroup_network, adgroup_id_network, cost, all_revenue, cohort_all_revenue
 *
 * Filters to Facebook rows only, skips invalid campaign IDs.
 * Produces two aggregation maps per entity:
 *   - cohort_all_revenue (D0 ROAS)
 *   - all_revenue (%Profit and Profit)
 *
 * Runs entirely client-side — no server upload.
 */

import Papa from 'papaparse';
import type { AdjustRow } from '@/lib/types';

interface RawAdjustRow {
  app: string;
  channel: string;
  campaign_network: string;
  campaign_id_network: string;
  adgroup_network: string;
  adgroup_id_network: string;
  cost: number | string;
  all_revenue: number | string;
  cohort_all_revenue: number | string;
}

/** Adjust exports these as campaign ID for unattributed traffic — skip them */
const INVALID_IDS = new Set(['unknown', 'expired attributions', '']);

function isValidCampaignId(id: string): boolean {
  if (!id) return false;
  if (INVALID_IDS.has(id.trim().toLowerCase())) return false;
  return /^\d+$/.test(id.trim()); // FB campaign IDs are pure numeric strings
}

function toNum(val: number | string | undefined): number {
  if (val === undefined || val === null || val === '') return 0;
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  return isNaN(n) ? 0 : n;
}

/**
 * Parses the Adjust CSV file, filters to Facebook rows, and returns AdjustRows.
 * @param appFilter - Optional app name to restrict to one app in a multi-app CSV
 */
export function parseAdjustCsv(file: File, appFilter?: string): Promise<AdjustRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<RawAdjustRow>(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete(results) {
        const rows: AdjustRow[] = [];
        for (const row of results.data) {
          if (row.channel?.toLowerCase() !== 'facebook') continue;
          if (!isValidCampaignId(String(row.campaign_id_network ?? ''))) continue;
          if (appFilter && row.app !== appFilter) continue;

          const adsetId = String(row.adgroup_id_network ?? '').trim();
          rows.push({
            campaign_id: String(row.campaign_id_network).trim(),
            campaign_name: row.campaign_network ?? '',
            app: row.app ?? '',
            // cohort_all_revenue → D0 ROAS numerator
            revenue: toNum(row.cohort_all_revenue),
            // all_revenue → %Profit and Profit calculations
            all_revenue: toNum(row.all_revenue),
            adset_id: adsetId || undefined,
            adset_name: row.adgroup_network ? String(row.adgroup_network) : undefined,
          });
        }
        resolve(rows);
      },
      error(err) {
        reject(new Error(`CSV parse error: ${err.message}`));
      },
    });
  });
}

/**
 * Reads only the unique app names from the CSV for the app filter dropdown.
 * Faster than full parse — stops caring about other columns.
 */
export function parseAppsFromCsv(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<RawAdjustRow>(file, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
      complete(results) {
        const apps = new Set<string>();
        for (const row of results.data) {
          if (row.app) apps.add(row.app);
        }
        resolve([...apps].sort());
      },
      error(err) {
        reject(new Error(`CSV parse error: ${err.message}`));
      },
    });
  });
}

/**
 * Aggregates AdjustRows by campaign_id, summing cohort_all_revenue.
 * Used for D0 ROAS = cohort_all_revenue / spend.
 */
export function aggregateByCampaignId(rows: AdjustRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.campaign_id, (map.get(row.campaign_id) ?? 0) + row.revenue);
  }
  return map;
}

/**
 * Aggregates AdjustRows by campaign_id, summing all_revenue.
 * Used for %Profit and Profit = (all_revenue - spend) calculations.
 */
export function aggregateAllRevByCampaignId(rows: AdjustRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.campaign_id, (map.get(row.campaign_id) ?? 0) + row.all_revenue);
  }
  return map;
}

/**
 * Returns a map of campaign_id → app_name from Adjust rows.
 * Used to populate the App filter dropdown using CSV data (not FB API app_name which is often null).
 */
export function aggregateAppByCampaignId(rows: AdjustRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.app && !map.has(row.campaign_id)) {
      map.set(row.campaign_id, row.app);
    }
  }
  return map;
}

/**
 * Aggregates AdjustRows by adset_id, summing cohort_all_revenue.
 * Used for adset-level D0 ROAS in the expanded view.
 */
export function aggregateByAdSetId(rows: AdjustRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row.adset_id) continue;
    map.set(row.adset_id, (map.get(row.adset_id) ?? 0) + row.revenue);
  }
  return map;
}

/**
 * Aggregates AdjustRows by adset_id, summing all_revenue.
 * Used for adset-level %Profit and Profit in the expanded view.
 */
export function aggregateAllRevByAdSetId(rows: AdjustRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row.adset_id) continue;
    map.set(row.adset_id, (map.get(row.adset_id) ?? 0) + row.all_revenue);
  }
  return map;
}
