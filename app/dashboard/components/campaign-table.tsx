'use client';

import type { MergedCampaign } from '@/lib/types';
import { roasColorClass, formatRoas } from '@/lib/adjust/merge';

interface Props {
  campaigns: MergedCampaign[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  sortCol: keyof MergedCampaign;
  sortDir: 'asc' | 'desc';
  onSort: (col: keyof MergedCampaign) => void;
}

function fmtUsd(v: number | null) {
  if (v === null || v === 0) return '—';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtNum(v: number | null) {
  if (v === null) return '—';
  return v.toLocaleString('en-US');
}

function SortBtn({
  col, sortCol, sortDir, onSort,
}: { col: keyof MergedCampaign; sortCol: keyof MergedCampaign; sortDir: 'asc' | 'desc'; onSort: (c: keyof MergedCampaign) => void }) {
  const active = col === sortCol;
  return (
    <button onClick={() => onSort(col)} className="hover:text-gray-900 select-none">
      {active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : <span className="text-gray-300"> ↕</span>}
    </button>
  );
}

export default function CampaignTable({ campaigns, selectedIds, onSelectionChange, sortCol, sortDir, onSort }: Props) {
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
      <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-400">
        No campaigns match the current filter.
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            {/* Section header row */}
            <tr className="border-b border-gray-200">
              {/* Checkbox + Campaign */}
              <th colSpan={2} className="px-3 py-2 text-left bg-gray-50 border-r border-gray-200" />

              {/* Section 1: Facebook Ads */}
              <th colSpan={6} className="px-3 py-1.5 text-center text-xs font-semibold text-blue-700 bg-blue-50 border-r border-blue-100 tracking-wide uppercase">
                Facebook Ads Data
              </th>

              {/* Section 2: Adjust CSV */}
              <th colSpan={1} className="px-3 py-1.5 text-center text-xs font-semibold text-emerald-700 bg-emerald-50 border-r border-emerald-100 tracking-wide uppercase">
                Adjust CSV
              </th>

              {/* Section 3: Result */}
              <th colSpan={2} className="px-3 py-1.5 text-center text-xs font-semibold text-purple-700 bg-purple-50 tracking-wide uppercase">
                Result
              </th>
            </tr>

            {/* Column header row */}
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-500 font-medium">
              {/* Checkbox */}
              <th className="w-10 px-4 py-2.5">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-gray-300" />
              </th>

              {/* Campaign (no section color) */}
              <th className="px-3 py-2.5 text-left whitespace-nowrap border-r border-gray-200">
                Campaign
              </th>

              {/* FB section columns */}
              <th className="px-3 py-2.5 text-left whitespace-nowrap bg-blue-50/40">
                Status
              </th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50/40 cursor-pointer" onClick={() => onSort('spend')}>
                Spend <SortBtn col="spend" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              </th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50/40 cursor-pointer" onClick={() => onSort('impressions')}>
                Impr. <SortBtn col="impressions" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              </th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50/40 cursor-pointer" onClick={() => onSort('clicks')}>
                Clicks <SortBtn col="clicks" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              </th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50/40 cursor-pointer" onClick={() => onSort('cpm')}>
                CPM <SortBtn col="cpm" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              </th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50/40 cursor-pointer border-r border-blue-100" onClick={() => onSort('cpc')}>
                CPC <SortBtn col="cpc" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              </th>

              {/* Adjust section */}
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-emerald-50/40 cursor-pointer border-r border-emerald-100" onClick={() => onSort('adjust_revenue')}>
                Revenue <SortBtn col="adjust_revenue" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              </th>

              {/* Result section */}
              <th className="px-3 py-2.5 text-center whitespace-nowrap bg-purple-50/40">
                ID Match
              </th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-purple-50/40 cursor-pointer" onClick={() => onSort('roas')}>
                ROAS <SortBtn col="roas" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100">
            {campaigns.map((c) => (
              <tr
                key={c.campaign_id}
                className={`hover:bg-gray-50 transition-colors ${selectedIds.has(c.campaign_id) ? 'bg-blue-50' : ''}`}
              >
                {/* Checkbox */}
                <td className="px-4 py-2.5">
                  <input type="checkbox" checked={selectedIds.has(c.campaign_id)} onChange={() => toggleOne(c.campaign_id)} className="rounded border-gray-300" />
                </td>

                {/* Campaign name + ID */}
                <td className="px-3 py-2.5 max-w-xs border-r border-gray-100">
                  <div className="font-medium text-gray-900 truncate" title={c.campaign_name}>{c.campaign_name}</div>
                  <div className="text-xs text-gray-400 font-mono">{c.campaign_id}</div>
                </td>

                {/* FB section */}
                <td className="px-3 py-2.5 bg-blue-50/20">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                    Active
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 bg-blue-50/20">{fmtUsd(c.spend)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600 bg-blue-50/20">{fmtNum(c.impressions)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600 bg-blue-50/20">{fmtNum(c.clicks)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600 bg-blue-50/20">{fmtUsd(c.cpm)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600 bg-blue-50/20 border-r border-blue-100">{fmtUsd(c.cpc)}</td>

                {/* Adjust section */}
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 bg-emerald-50/20 border-r border-emerald-100">
                  {c.has_adjust_data ? fmtUsd(c.adjust_revenue) : <span className="text-gray-300">—</span>}
                </td>

                {/* Result section */}
                <td className="px-3 py-2.5 text-center bg-purple-50/20">
                  {c.has_adjust_data ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                      ✓ Matched
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                      ✗ No match
                    </span>
                  )}
                </td>
                <td className={`px-3 py-2.5 text-right font-semibold tabular-nums bg-purple-50/20 ${roasColorClass(c.roas)}`}>
                  {formatRoas(c.roas)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
