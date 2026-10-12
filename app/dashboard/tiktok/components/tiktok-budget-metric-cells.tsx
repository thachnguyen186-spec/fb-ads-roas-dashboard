/** Spend / ROAS / %Profit / Profit cells for one budget-modal row (colors match the FB ad set modal). */

import { formatProfit, formatRoas, roasColorClass } from '@/lib/adjust/merge';
import { formatUsd } from '@/lib/utils';
import type { TiktokItemMetrics } from './tiktok-budget-metrics';

const sign = (v: number | null) => (v === null ? 'text-slate-300' : v >= 0 ? 'text-emerald-600' : 'text-red-600');

export default function TiktokBudgetMetricCells({ m }: { m: TiktokItemMetrics }) {
  return (
    <>
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{m.spend != null ? formatUsd(m.spend) : '—'}</td>
      <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${roasColorClass(m.roas)}`}>{m.roas != null ? formatRoas(m.roas) : '—'}</td>
      <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${sign(m.profit_pct)}`}>{formatProfit(m.profit_pct)}</td>
      <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${sign(m.profit)}`}>{m.profit != null ? formatUsd(m.profit) : '—'}</td>
    </>
  );
}
