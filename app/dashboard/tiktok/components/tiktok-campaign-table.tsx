'use client';

import { roasColorClass, formatRoas, formatProfit } from '@/lib/adjust/merge';
import { formatUsd, formatNumber } from '@/lib/utils';
import type { MergedTiktokCampaign } from '@/lib/types';

function SortBtn({ col, sortCol, sortDir, onSort }: {
  col: string; sortCol: string; sortDir: 'asc' | 'desc'; onSort: (c: string) => void;
}) {
  return (
    <button onClick={() => onSort(col)} className="hover:text-slate-800 select-none">
      {col === sortCol ? (sortDir === 'asc' ? ' ↑' : ' ↓') : <span className="text-slate-400"> ↕</span>}
    </button>
  );
}

interface Props {
  campaigns: MergedTiktokCampaign[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  sortCol: string;
  sortDir: 'asc' | 'desc';
  onSort: (col: string) => void;
  showAdvertiserColumn: boolean;
}

export default function TiktokCampaignTable({
  campaigns, selectedIds, onSelectionChange, sortCol, sortDir, onSort, showAdvertiserColumn,
}: Props) {
  const allSelected = campaigns.length > 0 && campaigns.every((c) => selectedIds.has(c.campaign_id));

  function toggleAll() {
    onSelectionChange(allSelected ? new Set() : new Set(campaigns.map((c) => c.campaign_id)));
  }
  function toggleOne(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectionChange(next);
  }

  if (campaigns.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-400">
        No campaigns match the current filter.
      </div>
    );
  }

  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
  const totalRevenue = campaigns.reduce((s, c) => s + (c.adjust_revenue ?? 0), 0);
  const totalAllRevenue = campaigns.reduce((s, c) => s + (c.adjust_all_revenue ?? 0), 0);
  const totalProfit = campaigns.reduce((s, c) => s + (c.profit ?? 0), 0);
  const avgRoas = totalSpend > 0 && totalRevenue > 0 ? totalRevenue / totalSpend : null;
  const avgProfitPct = totalAllRevenue > 0 ? ((totalAllRevenue - totalSpend) / totalAllRevenue) * 100 : null;
  const matchedCount = campaigns.filter((c) => c.has_adjust_data).length;

  const th = 'px-3 py-2.5 text-right whitespace-nowrap bg-slate-100 border-b border-slate-300';

  return (
    <div className="h-full flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex-1 min-h-0 overflow-x-scroll overflow-y-scroll" style={{ scrollbarGutter: 'stable' }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead className="sticky top-0 z-10" style={{ boxShadow: '0 3px 10px rgba(0,0,0,0.12)' }}>
            <tr className="bg-slate-100 text-slate-600 font-semibold">
              <th className="sticky left-0 z-20 w-10 px-4 py-2.5 border-b border-slate-300 bg-slate-100">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-slate-300 bg-white h-5 w-5 cursor-pointer" />
              </th>
              <th className="sticky left-10 z-20 px-3 py-2.5 text-left whitespace-nowrap border-r border-slate-300 border-b border-slate-300 bg-slate-100">Campaign</th>
              {showAdvertiserColumn && <th className="px-3 py-2.5 text-left whitespace-nowrap bg-slate-100 border-b border-slate-300">Advertiser</th>}
              <th className="px-3 py-2.5 text-left whitespace-nowrap bg-slate-100 border-b border-slate-300">Status</th>
              <th className={th}>Budget</th>
              <th className={`${th} cursor-pointer`} onClick={() => onSort('spend')}>Spend <SortBtn col="spend" sortCol={sortCol} sortDir={sortDir} onSort={onSort} /></th>
              <th className={th}>Impr.</th>
              <th className={th}>Clicks</th>
              <th className={th}>CPC</th>
              <th className={`${th} cursor-pointer`} onClick={() => onSort('adjust_revenue')}>Revenue <SortBtn col="adjust_revenue" sortCol={sortCol} sortDir={sortDir} onSort={onSort} /></th>
              <th className="px-3 py-2.5 text-center whitespace-nowrap bg-slate-100 border-b border-slate-300">ID Match</th>
              <th className={`${th} cursor-pointer`} onClick={() => onSort('roas')}>ROAS <SortBtn col="roas" sortCol={sortCol} sortDir={sortDir} onSort={onSort} /></th>
              <th className={`${th} cursor-pointer`} onClick={() => onSort('profit_pct')}>%Profit <SortBtn col="profit_pct" sortCol={sortCol} sortDir={sortDir} onSort={onSort} /></th>
              <th className={`${th} cursor-pointer`} onClick={() => onSort('profit')}>Profit <SortBtn col="profit" sortCol={sortCol} sortDir={sortDir} onSort={onSort} /></th>
            </tr>
            <tr className="bg-slate-100 text-sm font-semibold text-slate-700">
              <th className="sticky left-0 z-20 w-10 px-4 py-2 border-b-2 border-slate-400 bg-slate-100" />
              <th className="sticky left-10 z-20 px-3 py-2 text-left text-slate-500 font-medium border-r border-slate-300 border-b-2 border-slate-400 whitespace-nowrap bg-slate-100">
                {campaigns.length} campaigns · {matchedCount} matched
              </th>
              {showAdvertiserColumn && <th className="px-3 py-2 bg-slate-100 border-b-2 border-slate-400" />}
              <th className="px-3 py-2 bg-slate-100 border-b-2 border-slate-400" />
              <th className="px-3 py-2 text-right bg-slate-100 border-b-2 border-slate-400 text-slate-400">—</th>
              <th className="px-3 py-2 text-right tabular-nums bg-slate-100 border-b-2 border-slate-400">{formatUsd(totalSpend)}</th>
              <th className="px-3 py-2 bg-slate-100 border-b-2 border-slate-400" colSpan={2} />
              <th className="px-3 py-2 bg-slate-100 border-b-2 border-slate-400" />
              <th className="px-3 py-2 text-right tabular-nums bg-slate-100 border-b-2 border-slate-400">
                {totalRevenue > 0 ? formatUsd(totalRevenue) : <span className="text-slate-400">—</span>}
              </th>
              <th className="px-3 py-2 text-center text-slate-400 bg-slate-100 border-b-2 border-slate-400">—</th>
              <th className={`px-3 py-2 text-right tabular-nums bg-slate-100 border-b-2 border-slate-400 ${avgRoas === null ? 'text-slate-400' : avgRoas >= 2 ? 'text-emerald-600' : avgRoas >= 1 ? 'text-amber-600' : 'text-red-600'}`}>
                {avgRoas !== null ? `${avgRoas.toFixed(2)}x` : '—'}
              </th>
              <th className={`px-3 py-2 text-right tabular-nums bg-slate-100 border-b-2 border-slate-400 ${avgProfitPct === null ? 'text-slate-400' : avgProfitPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {avgProfitPct !== null ? `${avgProfitPct >= 0 ? '+' : ''}${avgProfitPct.toFixed(1)}%` : '—'}
              </th>
              <th className={`px-3 py-2 text-right tabular-nums bg-slate-100 border-b-2 border-slate-400 ${totalProfit === 0 ? 'text-slate-400' : totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {totalRevenue > 0 ? formatUsd(totalProfit) : <span className="text-slate-400">—</span>}
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {campaigns.map((c) => (
              <tr key={c.campaign_id} className={`group hover:bg-slate-50 transition-colors ${selectedIds.has(c.campaign_id) ? 'bg-indigo-50' : ''}`}>
                <td className={`sticky left-0 z-[1] px-4 py-2.5 ${selectedIds.has(c.campaign_id) ? 'bg-indigo-50' : 'bg-white group-hover:bg-slate-50'}`}>
                  <input type="checkbox" checked={selectedIds.has(c.campaign_id)} onChange={() => toggleOne(c.campaign_id)} className="rounded border-slate-300 bg-white h-5 w-5 cursor-pointer" />
                </td>
                <td className={`sticky left-10 z-[1] px-3 py-2.5 max-w-xs border-r border-slate-100 ${selectedIds.has(c.campaign_id) ? 'bg-indigo-50' : 'bg-white group-hover:bg-slate-50'}`}>
                  <div className="font-medium text-slate-900 truncate" title={c.campaign_name}>{c.campaign_name}</div>
                  <div className="text-xs text-slate-400 font-mono">{c.campaign_id}</div>
                </td>
                {showAdvertiserColumn && (
                  <td className="px-3 py-2.5">
                    <span className="text-xs text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">{c.advertiser_name}</span>
                  </td>
                )}
                <td className="px-3 py-2.5">
                  {c.status === 'ENABLE'
                    ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">Enabled</span>
                    : <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Disabled</span>}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                  {formatUsd(c.budget)} <span className="text-slate-400 text-xs">{c.budget_mode === 'DAILY' ? '/d' : c.budget_mode === 'LIFETIME' ? ' lt' : ''}</span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{formatUsd(c.spend)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{formatNumber(c.impressions)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{formatNumber(c.clicks)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{formatUsd(c.cpc)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                  {c.has_adjust_data ? formatUsd(c.adjust_revenue) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2.5 text-center">
                  {c.has_adjust_data
                    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">✓ Matched</span>
                    : <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">✗ No match</span>}
                </td>
                <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${roasColorClass(c.roas)}`}>{formatRoas(c.roas)}</td>
                <td className={`px-3 py-2.5 text-right tabular-nums text-sm ${c.profit_pct === null ? 'text-slate-300' : c.profit_pct >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}`}>
                  {formatProfit(c.profit_pct)}
                </td>
                <td className={`px-3 py-2.5 text-right tabular-nums text-sm font-medium ${c.profit === null ? 'text-slate-300' : c.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {c.profit !== null ? formatUsd(c.profit) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
