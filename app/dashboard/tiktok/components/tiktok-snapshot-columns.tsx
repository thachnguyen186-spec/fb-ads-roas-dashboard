'use client';

/** Snapshot comparison columns for the TikTok campaign table (campaign level). Per snapshot: 5 saved metrics + 5 deltas. */

import { Fragment } from 'react';
import { roasColorClass, formatRoas, formatProfit } from '@/lib/adjust/merge';
import { formatUsd } from '@/lib/utils';
import { snapshotSubtotals } from '@/lib/tiktok/snapshot-subtotals';
import type { MergedTiktokCampaign, SnapshotComparison, SnapshotRow } from '@/lib/types';

/** Columns added per snapshot comparison (keep in sync with the cells below). */
export const SNAPSHOT_COLS_PER_COMPARISON = 10;

const OLD_HEADERS = ['Spend', 'Revenue', 'ROAS', '%Profit', 'Profit'];
const DELTA_CELL = 'px-3 py-2.5 text-right tabular-nums bg-sky-50/40 text-xs font-semibold';
const OLD_CELL = 'px-3 py-2.5 text-right tabular-nums bg-amber-50/40 text-xs';

function fmtDelta(v: number | null) {
  return v !== null ? `${v >= 0 ? '+' : '-'}${formatUsd(Math.abs(v))}` : '—';
}
function deltaColor(v: number | null) {
  return v === null ? 'text-slate-300' : v >= 0 ? 'text-emerald-600' : 'text-red-600';
}

/** Group header cells (one amber + one sky th per snapshot) for a top header row. */
export function SnapshotGroupHeaders({ comparisons }: { comparisons: SnapshotComparison[] }) {
  return (
    <>
      {comparisons.map((comp, i) => (
        <Fragment key={comp.id}>
          <th colSpan={5} className="px-3 py-1.5 text-center text-xs font-semibold text-amber-700 bg-amber-50 border-l border-amber-200 border-b border-amber-200 tracking-wide uppercase whitespace-nowrap">
            #{i + 1} {comp.name}
          </th>
          <th colSpan={5} className="px-3 py-1.5 text-center text-xs font-semibold text-sky-700 bg-sky-50 border-l border-sky-200 border-b border-sky-200 tracking-wide uppercase whitespace-nowrap">
            Δ vs {i === comparisons.length - 1 ? 'Current' : `#${i + 2}`}
          </th>
        </Fragment>
      ))}
    </>
  );
}

/** Snapshot field behind each of the 5 metric columns (same order as OLD_HEADERS). */
const SORT_FIELDS = ['spend', 'adjust_revenue', 'roas', 'profit_pct', 'profit'] as const;

interface SortProps { sortCol: string; sortDir: 'asc' | 'desc'; onSort: (col: string) => void }

/** Column header cells for the metric header row. Every snapshot/delta column is click-sortable. */
export function SnapshotColumnHeaders({ comparisons, sortCol, sortDir, onSort }: { comparisons: SnapshotComparison[] } & SortProps) {
  const arrow = (key: string) => (key === sortCol ? (sortDir === 'asc' ? ' ↑' : ' ↓') : <span className="text-slate-400"> ↕</span>);
  return (
    <>
      {comparisons.map((comp) => (
        <Fragment key={comp.id}>
          {OLD_HEADERS.map((h, k) => {
            const key = `snap:${comp.id}:${SORT_FIELDS[k]}`;
            return (
              <th key={`o${k}`} onClick={() => onSort(key)} className={`px-3 py-2.5 text-right whitespace-nowrap bg-amber-50 hover:bg-amber-100 cursor-pointer select-none border-b border-amber-200 text-xs font-semibold text-amber-800 ${k === 0 ? 'border-l border-amber-200' : ''}`}>{h}{arrow(key)}</th>
            );
          })}
          {OLD_HEADERS.map((h, k) => {
            const key = `delta:${comp.id}:${SORT_FIELDS[k]}`;
            return (
              <th key={`d${k}`} onClick={() => onSort(key)} className={`px-3 py-2.5 text-right whitespace-nowrap bg-sky-50 hover:bg-sky-100 cursor-pointer select-none border-b border-sky-200 text-xs font-semibold text-sky-800 ${k === 0 ? 'border-l border-sky-200' : ''}`}>Δ {h}{arrow(key)}</th>
            );
          })}
        </Fragment>
      ))}
    </>
  );
}

/** Totals-row cells per snapshot: aggregated saved metrics + deltas (FB snapSubtotals parity). */
export function SnapshotTotalsCells({ campaigns, comparisons, liveProfitPct }: {
  campaigns: MergedTiktokCampaign[]; comparisons: SnapshotComparison[]; liveProfitPct: number | null;
}) {
  const T = 'px-3 py-2 text-right tabular-nums text-xs font-semibold border-b-2';
  const OLD_T = `${T} bg-amber-100 border-amber-300`;
  const DELTA_T = `${T} bg-sky-100 border-sky-300`;
  const signColor = (v: number | null) => (v === null ? 'text-slate-400' : v >= 0 ? 'text-emerald-600' : 'text-red-600');
  return (
    <>
      {comparisons.map((comp) => {
        const st = snapshotSubtotals(campaigns, comp, liveProfitPct);
        return (
          <Fragment key={comp.id}>
            <th className={`${OLD_T} text-slate-700`}>{st.spend > 0 ? formatUsd(st.spend) : '—'}</th>
            <th className={`${OLD_T} text-slate-700`}>{st.revenue > 0 ? formatUsd(st.revenue) : '—'}</th>
            <th className={`${OLD_T} ${roasColorClass(st.roas)}`}>{st.roas !== null ? formatRoas(st.roas) : '—'}</th>
            <th className={`${OLD_T} ${signColor(st.profitPct)}`}>{st.profitPct !== null ? formatProfit(st.profitPct) : '—'}</th>
            <th className={`${OLD_T} ${signColor(st.profit)}`}>{st.profit !== null ? formatUsd(st.profit) : '—'}</th>
            <th className={`${DELTA_T} ${deltaColor(st.deltaSpend)}`}>{fmtDelta(st.deltaSpend)}</th>
            <th className={`${DELTA_T} ${deltaColor(st.deltaRevenue)}`}>{fmtDelta(st.deltaRevenue)}</th>
            <th className={`${DELTA_T} ${deltaColor(st.deltaRoas)}`}>{st.deltaRoas !== null ? `${st.deltaRoas >= 0 ? '+' : ''}${st.deltaRoas.toFixed(2)}x` : '—'}</th>
            <th className={`${DELTA_T} ${deltaColor(st.deltaProfitPct)}`}>{st.deltaProfitPct !== null ? `${st.deltaProfitPct >= 0 ? '+' : ''}${st.deltaProfitPct.toFixed(1)}%` : '—'}</th>
            <th className={`${DELTA_T} ${deltaColor(st.deltaProfit)}`}>{fmtDelta(st.deltaProfit)}</th>
          </Fragment>
        );
      })}
    </>
  );
}

/** Row cells: saved snapshot metrics + deltas vs next-newer snapshot (or live data for the last one). */
export function SnapshotRowCells({ campaign: c, comparisons }: { campaign: MergedTiktokCampaign; comparisons: SnapshotComparison[] }) {
  return (
    <>
      {comparisons.map((comp) => {
        const snap = comp.campaignMap.get(c.campaign_id) ?? null;
        const prev = comp.prevCampaignMap
          ? (comp.prevCampaignMap.get(c.campaign_id) ?? null)
          : c;
        const delta = (f: keyof Pick<SnapshotRow, 'spend' | 'adjust_revenue' | 'roas' | 'profit_pct' | 'profit'>): number | null => {
          const a = prev?.[f] ?? null;
          const b = snap?.[f] ?? null;
          return a !== null && b !== null ? a - b : null;
        };
        const dSpend = delta('spend'); const dRev = delta('adjust_revenue'); const dRoas = delta('roas');
        const dPct = delta('profit_pct'); const dProfit = delta('profit');
        const dash = <span className="text-slate-300">—</span>;
        return (
          <Fragment key={comp.id}>
            <td className={`${OLD_CELL} border-l border-amber-100 text-slate-700`}>{snap?.spend != null ? formatUsd(snap.spend) : dash}</td>
            <td className={`${OLD_CELL} text-slate-700`}>{snap?.adjust_revenue != null ? formatUsd(snap.adjust_revenue) : dash}</td>
            <td className={`${OLD_CELL} font-semibold ${roasColorClass(snap?.roas ?? null)}`}>{snap ? formatRoas(snap.roas) : dash}</td>
            <td className={`${OLD_CELL} font-medium ${snap?.profit_pct == null ? 'text-slate-300' : snap.profit_pct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{snap?.profit_pct != null ? formatProfit(snap.profit_pct) : '—'}</td>
            <td className={`${OLD_CELL} font-medium ${snap?.profit == null ? 'text-slate-300' : snap.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{snap?.profit != null ? formatUsd(snap.profit) : '—'}</td>
            <td className={`${DELTA_CELL} border-l border-sky-100 ${deltaColor(dSpend)}`}>{fmtDelta(dSpend)}</td>
            <td className={`${DELTA_CELL} ${deltaColor(dRev)}`}>{fmtDelta(dRev)}</td>
            <td className={`${DELTA_CELL} ${deltaColor(dRoas)}`}>{dRoas !== null ? `${dRoas >= 0 ? '+' : ''}${dRoas.toFixed(2)}x` : '—'}</td>
            <td className={`${DELTA_CELL} ${deltaColor(dPct)}`}>{dPct !== null ? `${dPct >= 0 ? '+' : ''}${dPct.toFixed(1)}%` : '—'}</td>
            <td className={`${DELTA_CELL} ${deltaColor(dProfit)}`}>{fmtDelta(dProfit)}</td>
          </Fragment>
        );
      })}
    </>
  );
}
