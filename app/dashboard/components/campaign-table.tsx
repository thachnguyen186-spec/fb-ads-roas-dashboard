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

const COLS: { key: keyof MergedCampaign; label: string; align?: 'right' }[] = [
  { key: 'campaign_name', label: 'Campaign' },
  { key: 'status', label: 'Status' },
  { key: 'spend', label: 'Spend', align: 'right' },
  { key: 'adjust_revenue', label: 'Revenue', align: 'right' },
  { key: 'roas', label: 'ROAS', align: 'right' },
  { key: 'impressions', label: 'Impr.', align: 'right' },
  { key: 'clicks', label: 'Clicks', align: 'right' },
  { key: 'cpm', label: 'CPM', align: 'right' },
  { key: 'cpc', label: 'CPC', align: 'right' },
];

function fmtUsd(v: number | null) {
  if (v === null) return '—';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtNum(v: number | null) {
  if (v === null) return '—';
  return v.toLocaleString('en-US');
}

function StatusBadge({ status }: { status: string }) {
  const active = status === 'ACTIVE';
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
        active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
      }`}
    >
      {active ? 'Active' : 'Paused'}
    </span>
  );
}

export default function CampaignTable({
  campaigns,
  selectedIds,
  onSelectionChange,
  sortCol,
  sortDir,
  onSort,
}: Props) {
  const allSelected = campaigns.length > 0 && campaigns.every((c) => selectedIds.has(c.campaign_id));

  function toggleAll() {
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(campaigns.map((c) => c.campaign_id)));
    }
  }

  function toggleOne(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  }

  function SortIcon({ col }: { col: keyof MergedCampaign }) {
    if (col !== sortCol) return <span className="text-gray-300 ml-1">↕</span>;
    return <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
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
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="w-10 px-4 py-2.5">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="rounded border-gray-300"
                />
              </th>
              {COLS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => onSort(col.key)}
                  className={`px-3 py-2.5 font-medium text-gray-500 cursor-pointer hover:text-gray-700 whitespace-nowrap select-none ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {col.label}
                  <SortIcon col={col.key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {campaigns.map((c) => (
              <tr
                key={c.campaign_id}
                className={`hover:bg-gray-50 transition-colors ${
                  selectedIds.has(c.campaign_id) ? 'bg-blue-50' : ''
                }`}
              >
                <td className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(c.campaign_id)}
                    onChange={() => toggleOne(c.campaign_id)}
                    className="rounded border-gray-300"
                  />
                </td>
                <td className="px-3 py-2.5 max-w-xs">
                  <div className="font-medium text-gray-900 truncate" title={c.campaign_name}>
                    {c.campaign_name}
                  </div>
                  <div className="text-xs text-gray-400">{c.campaign_id}</div>
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={c.effective_status} />
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                  {fmtUsd(c.spend)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                  {c.has_adjust_data ? fmtUsd(c.adjust_revenue) : <span className="text-gray-300">—</span>}
                </td>
                <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${roasColorClass(c.roas)}`}>
                  {formatRoas(c.roas)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">
                  {fmtNum(c.impressions)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">
                  {fmtNum(c.clicks)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">
                  {fmtUsd(c.cpm)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">
                  {fmtUsd(c.cpc)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
