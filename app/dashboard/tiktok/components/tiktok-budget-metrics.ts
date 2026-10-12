/** Per-item performance metrics shown in the budget modal ("Current" = live row, otherwise a saved snapshot). */

import type { SnapshotComparison } from '@/lib/types';

export interface TiktokItemMetrics {
  spend: number | null;
  roas: number | null;
  profit_pct: number | null;
  profit: number | null;
}

export const EMPTY_METRICS: TiktokItemMetrics = { spend: null, roas: null, profit_pct: null, profit: null };

/** Live metrics when no snapshot is selected; else the snapshot's saved values (empty if the item isn't in it). */
export function metricsForVersion(
  itemId: string,
  live: TiktokItemMetrics | undefined,
  snapshot: SnapshotComparison | null,
): TiktokItemMetrics {
  if (!snapshot) return live ?? EMPTY_METRICS;
  const s = snapshot.campaignMap.get(itemId);
  return s ? { spend: s.spend, roas: s.roas, profit_pct: s.profit_pct, profit: s.profit } : EMPTY_METRICS;
}
