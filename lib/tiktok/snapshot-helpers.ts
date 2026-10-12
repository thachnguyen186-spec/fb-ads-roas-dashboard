/** Pure helpers for TikTok campaign snapshots. Reuses the FB SnapshotRow/SnapshotData shapes (campaign level only;
 * `adsets` stays empty) so SnapshotToolbar and /api/snapshots work unchanged. */

import type { MergedTiktokCampaign, SnapshotComparison, SnapshotData, SnapshotMeta, SnapshotRow } from '@/lib/types';

export function toSnapshotData(campaigns: MergedTiktokCampaign[]): SnapshotData {
  const rows: SnapshotRow[] = campaigns.map((c) => ({
    campaign_id: c.campaign_id,
    campaign_name: c.campaign_name,
    spend: c.spend,
    adjust_revenue: c.adjust_revenue,
    roas: c.roas,
    profit_pct: c.profit_pct,
    profit: c.profit,
  }));
  return { campaigns: rows, adsets: [] };
}

/**
 * Layout: [oldest ... newest | Current]. Index i < n-1: delta = snapshot[i+1] - snapshot[i];
 * last index: delta = live data - snapshot (prevCampaignMap = null).
 */
export function buildSnapshotComparisons(
  comparedIds: string[],
  cache: Map<string, SnapshotData>,
  metas: SnapshotMeta[],
): SnapshotComparison[] {
  return comparedIds.flatMap((id, i) => {
    const data = cache.get(id);
    const meta = metas.find((s) => s.id === id);
    if (!data || !meta) return [];
    const prevId = i < comparedIds.length - 1 ? comparedIds[i + 1] : null;
    const prev = prevId ? cache.get(prevId) : null;
    return [{
      id,
      name: meta.name,
      campaignMap: new Map(data.campaigns.map((r) => [r.campaign_id, r])),
      adsetMap: new Map(),
      prevCampaignMap: prev ? new Map(prev.campaigns.map((r) => [r.campaign_id, r])) : null,
      prevAdsetMap: null,
    } satisfies SnapshotComparison];
  });
}
