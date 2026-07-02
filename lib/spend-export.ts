/**
 * Groups FB campaign spend by app and renders a "Spend by App" CSV.
 *
 * App is sourced purely from Facebook: campaigns are grouped by their FB app_id
 * (promoted_object.application_id, resolved server-side — see campaign-app-map.ts),
 * labelled with the FB-resolved app name. Campaigns with no FB app_id land under
 * "Unmapped". Spend is normalized to USD (VND ÷ rate) before grouping, then
 * converted to the chosen output currency at export time.
 *
 * Pure module — no React/DOM. Consumed by export-spend-modal.tsx.
 */

import type { CampaignRow } from '@/lib/types';

export type OutputCurrency = 'USD' | 'VND';

export interface SpendByApp {
  /** Display label: FB app name, falling back to app_id, else "Unmapped" */
  app: string;
  spendUsd: number;
  campaigns: number;
}

const UNMAPPED = 'Unmapped';

/** Normalize a campaign's native-currency spend to USD (VND divided by rate). */
function toUsd(spend: number, currency: string, vndRate: number): number {
  return currency === 'VND' ? spend / vndRate : spend;
}

/**
 * Aggregates per-campaign spend into per-app USD totals, sorted by spend desc.
 * Grouping key is the FB app_id (stable); campaigns without one merge into "Unmapped".
 * @param vndRate 1 USD = vndRate VND (used to normalize VND accounts)
 */
export function groupSpendByApp(campaigns: CampaignRow[], vndRate: number): SpendByApp[] {
  const acc = new Map<string, SpendByApp>();
  for (const c of campaigns) {
    const key = c.app_id ?? UNMAPPED;
    const label = c.app_name || c.app_id || UNMAPPED;
    const prev = acc.get(key) ?? { app: label, spendUsd: 0, campaigns: 0 };
    prev.spendUsd += toUsd(c.spend, c.currency, vndRate);
    prev.campaigns += 1;
    acc.set(key, prev);
  }
  return [...acc.values()].sort((a, b) => b.spendUsd - a.spendUsd);
}

/** Escape a value for a CSV cell (quote when it contains comma/quote/newline). */
function csvCell(val: string): string {
  return /[",\n\r]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val;
}

/** Format a USD amount into the output currency string (VND → integer, USD → 2dp). */
function formatMoney(usd: number, currency: OutputCurrency, vndRate: number): string {
  const val = currency === 'VND' ? usd * vndRate : usd;
  return currency === 'VND' ? String(Math.round(val)) : val.toFixed(2);
}

/**
 * Builds the CSV text (without BOM) for a spend-by-app report.
 * Columns: App, Spend (<currency>), % of Total, Campaigns — plus a Total row.
 */
export function buildSpendCsv(
  rows: SpendByApp[],
  outputCurrency: OutputCurrency,
  vndRate: number,
  rangeLabel: string,
): string {
  const totalUsd = rows.reduce((s, r) => s + r.spendUsd, 0);
  const pct = (usd: number) => (totalUsd > 0 ? `${((usd / totalUsd) * 100).toFixed(1)}%` : '0%');
  const totalCampaigns = rows.reduce((s, r) => s + r.campaigns, 0);

  const lines: string[] = [];
  lines.push(csvCell(`Spend by App — ${rangeLabel} — ${outputCurrency} (1 USD = ${vndRate.toLocaleString('en-US')} VND)`));
  lines.push('');
  lines.push(['App', `Spend (${outputCurrency})`, '% of Total', 'Campaigns'].join(','));
  for (const r of rows) {
    lines.push([csvCell(r.app), formatMoney(r.spendUsd, outputCurrency, vndRate), pct(r.spendUsd), String(r.campaigns)].join(','));
  }
  lines.push(['Total', formatMoney(totalUsd, outputCurrency, vndRate), totalUsd > 0 ? '100%' : '0%', String(totalCampaigns)].join(','));
  return lines.join('\r\n');
}
