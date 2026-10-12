/**
 * Totals-row values for one snapshot comparison on the TikTok campaign table — a port of the
 * FB dashboard's snapSubtotals (app/dashboard/components/campaign-table.tsx) so both totals
 * rows aggregate identically:
 * - ROAS = Σrevenue / Σspend (weighted, not an average of row ROAS)
 * - %Profit = Σprofit / Σall_revenue, with all_revenue derived as profit + spend
 * - Δ = "previous" (next-newer snapshot, or live data for the last one) − snapshot
 */

import type { MergedTiktokCampaign, SnapshotComparison, SnapshotRow } from '@/lib/types';

type Row = Pick<SnapshotRow, 'spend' | 'adjust_revenue' | 'roas' | 'profit'>;

export interface SnapshotSubtotals {
  spend: number;
  revenue: number;
  roas: number | null;
  profitPct: number | null;
  profit: number | null;
  deltaSpend: number;
  deltaRevenue: number;
  deltaRoas: number | null;
  deltaProfitPct: number | null;
  deltaProfit: number | null;
}

function sum(ids: string[], map: Map<string, Row>, f: 'spend' | 'adjust_revenue'): number {
  return ids.reduce((s, id) => s + (map.get(id)?.[f] ?? 0), 0);
}

/** Aggregate %Profit over rows that have both profit and spend. */
function aggregatePct(ids: string[], map: Map<string, Row>): number | null {
  let profit = 0;
  let allRev = 0;
  for (const id of ids) {
    const r = map.get(id);
    if (r?.profit == null || r?.spend == null) continue;
    profit += r.profit;
    allRev += r.profit + r.spend;
  }
  return allRev > 0 ? (profit / allRev) * 100 : null;
}

/** `liveProfitPct` = the live totals row %Profit, used as "previous" for the last comparison (FB does the same). */
export function snapshotSubtotals(campaigns: MergedTiktokCampaign[], comp: SnapshotComparison, liveProfitPct: number | null): SnapshotSubtotals {
  const ids = campaigns.map((c) => c.campaign_id);
  const snap = comp.campaignMap as Map<string, Row>;
  // Live rows double as the "previous" map for the last (oldest-vs-current) comparison.
  const prev: Map<string, Row> = (comp.prevCampaignMap as Map<string, Row> | null)
    ?? new Map(campaigns.map((c) => [c.campaign_id, c]));

  const spend = sum(ids, snap, 'spend');
  const revenue = sum(ids, snap, 'adjust_revenue');
  const withProfit = ids.filter((id) => snap.get(id)?.profit != null);
  const profitPct = aggregatePct(ids, snap);
  const prevPct = comp.prevCampaignMap ? aggregatePct(ids, prev) : liveProfitPct;

  const roasPairs = ids.filter((id) => snap.get(id)?.roas != null && prev.get(id)?.roas != null);
  const profitPairs = ids.filter((id) => snap.get(id)?.profit != null && prev.get(id)?.profit != null);

  return {
    spend,
    revenue,
    roas: spend > 0 && revenue > 0 ? revenue / spend : null,
    profitPct,
    profit: withProfit.length > 0 ? withProfit.reduce((s, id) => s + snap.get(id)!.profit!, 0) : null,
    deltaSpend: sum(ids, prev, 'spend') - spend,
    deltaRevenue: sum(ids, prev, 'adjust_revenue') - revenue,
    deltaRoas: roasPairs.length > 0
      ? roasPairs.reduce((s, id) => s + prev.get(id)!.roas! - snap.get(id)!.roas!, 0) / roasPairs.length
      : null,
    deltaProfitPct: prevPct !== null && profitPct !== null ? prevPct - profitPct : null,
    deltaProfit: profitPairs.length > 0
      ? profitPairs.reduce((s, id) => s + prev.get(id)!.profit! - snap.get(id)!.profit!, 0)
      : null,
  };
}
