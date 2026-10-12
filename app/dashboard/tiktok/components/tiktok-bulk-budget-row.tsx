/** One table row of the TikTok budget modal: name, version-dependent metrics, old/new budget, result mark. */

import { isDailyBudgetMode, TIKTOK_BUDGET_MODE_TOTAL } from '@/lib/tiktok/budget-limits';
import { formatUsd } from '@/lib/utils';
import TiktokBudgetMetricCells from './tiktok-budget-metric-cells';
import type { TiktokItemMetrics } from './tiktok-budget-metrics';
import type { TiktokActionItem } from './tiktok-action-bar';

export type RowResult = { ok: true } | { ok: false; error: string };

interface Props {
  item: TiktokActionItem;
  entityType: 'campaign' | 'adgroup';
  skipped: boolean;
  metrics: TiktokItemMetrics;
  value: string;
  error: string | null;
  result: RowResult | undefined;
  disabled: boolean;
  onChange: (raw: string) => void;
}

export default function TiktokBulkBudgetRow({ item, entityType, skipped, metrics, value, error, result, disabled, onChange }: Props) {
  const suffix = isDailyBudgetMode(item.budget_mode) ? '/day' : item.budget_mode === TIKTOK_BUDGET_MODE_TOTAL ? ' total' : '';
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-3 py-2.5">
        <div className="font-medium text-slate-800 truncate max-w-[200px]" title={item.name}>{item.name}</div>
        <div className="text-xs text-slate-400 font-mono">{item.id}</div>
      </td>
      <TiktokBudgetMetricCells m={metrics} />
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
        {skipped ? <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">Skipped</span> : formatUsd(item.budget) + suffix}
      </td>
      <td className="px-3 py-2.5 text-right">
        {skipped ? (
          <span className="text-xs text-slate-400">{entityType === 'campaign' ? 'budget set on ad groups' : 'no budget at this level'}</span>
        ) : (
          <div className="flex flex-col items-end gap-0.5">
            <div className="flex items-center gap-1">
              <span className="text-slate-400">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                className="w-28 px-2 py-1 border border-slate-300 rounded text-sm text-right text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 tabular-nums"
              />
            </div>
            {error && <span className="text-[10px] text-red-500">{error}</span>}
            {result && !result.ok && <span className="text-[10px] text-red-500 max-w-[200px] truncate" title={result.error}>{result.error}</span>}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 w-8 text-center">
        {result?.ok === true && <span className="text-emerald-600 text-xs">✓</span>}
        {result?.ok === false && <span className="text-red-600 text-xs">✗</span>}
      </td>
    </tr>
  );
}
