/**
 * Server-side Adjust Report API client.
 * Fetches today's campaign revenue data using an API token.
 * Returns AdjustRow[] — identical shape to parseAdjustCsv() output.
 *
 * Endpoint: https://automate.adjust.com/reports-service/csv_report
 * Auth: Authorization: Bearer {token}
 */

import Papa from 'papaparse';
import type { AdjustRow } from '@/lib/types';

const ADJUST_API_URL = 'https://automate.adjust.com/reports-service/csv_report';

/** Campaign IDs that Adjust uses for unattributed/invalid traffic — skip them */
const INVALID_IDS = new Set(['unknown', 'expired attributions', '']);

function isValidCampaignId(id: string): boolean {
  if (!id) return false;
  if (INVALID_IDS.has(id.trim().toLowerCase())) return false;
  return /^\d+$/.test(id.trim()); // FB campaign IDs are purely numeric
}

function toNum(val: unknown): number {
  if (val === undefined || val === null || val === '') return 0;
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  return isNaN(n) ? 0 : n;
}

/** Raw row shape returned by the Adjust Reports API CSV */
interface AdjustApiRow {
  app: string;
  partner_name: string;
  campaign_id_network: string;
  campaign_network: string;
  adgroup_id_network?: string;
  adgroup_network?: string;
  network_cost?: number | string;
  all_revenue: number | string;
  cohort_all_revenue?: number | string;
}

/**
 * Fetches today's Adjust revenue data via the Reports API.
 * Returns AdjustRow[] filtered to Facebook traffic only.
 *
 * @param token        Adjust API token (Bearer auth — from profiles.adjust_api_token, server-side only)
 * @param appTokens    One or more Adjust app tokens (required by Adjust API — from profiles.adjust_app_token)
 * @param appFilter    Optional: restrict rows to a specific app name
 */
export async function fetchAdjustRevenueToday(
  token: string,
  appTokens: string[],
  appFilter?: string,
): Promise<AdjustRow[]> {
  if (appTokens.length === 0) {
    throw new Error('Adjust app token(s) not configured. Add them in Settings.');
  }

  // Today in YYYY-MM-DD (UTC) — Adjust expects UTC dates
  const today = new Date().toISOString().slice(0, 10);

  const params = new URLSearchParams({
    date_period: `${today}:${today}`,
    dimensions: 'app,partner_name,campaign_id_network,campaign_network,adgroup_id_network,adgroup_network',
    metrics: 'network_cost,all_revenue,cohort_all_revenue',
    ad_spend_mode: 'network',
  });
  // Adjust requires app_token as a repeated param for each app
  for (const appToken of appTokens) {
    params.append('app_token', appToken);
  }

  const res = await fetch(`${ADJUST_API_URL}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    // 30s timeout — Adjust CSV reports can be slow for large apps
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    // Truncate response body to avoid leaking sensitive data in logs
    const text = await res.text().catch(() => '');
    throw new Error(`Adjust API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const csvText = await res.text();

  return new Promise((resolve, reject) => {
    Papa.parse<AdjustApiRow>(csvText, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete(results) {
        const rows: AdjustRow[] = [];
        for (const row of results.data) {
          // Re-check Facebook filter (API filter_by may not be exact match)
          if (!row.partner_name?.toLowerCase().includes('facebook')) continue;
          if (!isValidCampaignId(String(row.campaign_id_network ?? ''))) continue;
          if (appFilter && row.app !== appFilter) continue;

          const adsetId = String(row.adgroup_id_network ?? '').trim();
          rows.push({
            campaign_id: String(row.campaign_id_network).trim(),
            campaign_name: row.campaign_network ?? '',
            app: row.app ?? '',
            // cohort_all_revenue → D0 ROAS numerator; fallback to 0 if column absent
            revenue: toNum(row.cohort_all_revenue),
            // all_revenue → %Profit and Profit calculations
            all_revenue: toNum(row.all_revenue),
            adset_id: adsetId || undefined,
            adset_name: row.adgroup_network ? String(row.adgroup_network) : undefined,
          });
        }
        resolve(rows);
      },
      error(err: { message: string }) {
        reject(new Error(`Adjust CSV parse error: ${err.message}`));
      },
    });
  });
}
