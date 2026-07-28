'use client';

import { Info } from 'lucide-react';
import type { AccountingExportRow } from '@/lib/types';

export type SortKey = 'platform' | 'account_id' | 'account_name' | 'owner_label' | 'campaign_name' | 'currency' | 'spend' | 'target_label';
export interface SortState { key: SortKey; dir: 'asc' | 'desc' }

interface Props {
  rows: AccountingExportRow[];
  groupByOwner: boolean;
  sort: SortState | null;
  onSortChange: (key: SortKey) => void;
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'platform', label: 'Platform' },
  { key: 'account_id', label: 'Account ID' },
  { key: 'account_name', label: 'Account Name' },
  { key: 'owner_label', label: 'Owner/Department' },
  { key: 'campaign_name', label: 'Campaign Name' },
  { key: 'currency', label: 'Currency' },
  { key: 'spend', label: 'Spend' },
  { key: 'target_label', label: 'Target' },
];

function formatSpend(spend: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: currency === 'VND' ? 0 : 2 }).format(spend);
  } catch {
    return `${spend.toLocaleString()} ${currency}`;
  }
}

function sortRows(rows: AccountingExportRow[], sort: SortState | null): AccountingExportRow[] {
  if (!sort) return rows;
  const factor = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
    return String(av).localeCompare(String(bv)) * factor;
  });
}

function subtotalsByCurrency(rows: AccountingExportRow[]): { currency: string; total: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.currency, (map.get(r.currency) ?? 0) + r.spend);
  return [...map.entries()].map(([currency, total]) => ({ currency, total }));
}

function TargetCell({ row }: { row: AccountingExportRow }) {
  if (row.target_type !== 'website') return <span>{row.target_label}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {row.target_label}
      <span title="One observed destination — a campaign may run multiple destinations.">
        <Info className="w-3.5 h-3.5 text-slate-400" />
      </span>
    </span>
  );
}

function HeaderRow({ sort, onSortChange }: { sort: SortState | null; onSortChange: (key: SortKey) => void }) {
  return (
    <tr>
      {COLUMNS.map((col) => {
        const active = sort?.key === col.key;
        return (
          <th
            key={col.key}
            onClick={() => onSortChange(col.key)}
            className="text-left px-3 py-2 cursor-pointer select-none hover:text-slate-700"
          >
            {col.label}{active ? (sort!.dir === 'asc' ? ' ▲' : ' ▼') : ''}
          </th>
        );
      })}
    </tr>
  );
}

function Row({ row }: { row: AccountingExportRow }) {
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-3 py-2 text-slate-500">{row.platform === 'facebook' ? 'Facebook' : 'TikTok'}</td>
      <td className="px-3 py-2 text-slate-500">{row.account_id}</td>
      <td className="px-3 py-2">{row.account_name}</td>
      <td className="px-3 py-2 text-slate-500">{row.owner_label || <span className="text-slate-300">Unassigned</span>}</td>
      <td className="px-3 py-2">{row.campaign_name}</td>
      <td className="px-3 py-2 text-slate-500">{row.currency}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatSpend(row.spend, row.currency)}</td>
      <td className="px-3 py-2 text-slate-500"><TargetCell row={row} /></td>
    </tr>
  );
}

export default function ResultsTable({ rows, groupByOwner, sort, onSortChange }: Props) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400 py-8 text-center">No spend found for this range.</p>;
  }

  if (!groupByOwner) {
    const sorted = sortRows(rows, sort);
    return (
      <div className="border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <HeaderRow sort={sort} onSortChange={onSortChange} />
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((r) => <Row key={`${r.platform}:${r.campaign_id}`} row={r} />)}
          </tbody>
        </table>
      </div>
    );
  }

  const groups = new Map<string, AccountingExportRow[]>();
  for (const r of rows) {
    const key = r.owner_label || 'Unassigned';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([owner, groupRows]) => (
        <div key={owner} className="border border-slate-200 rounded-xl overflow-x-auto">
          <div className="px-3 py-2 bg-slate-100 font-medium text-sm text-slate-700">{owner}</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <HeaderRow sort={sort} onSortChange={onSortChange} />
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortRows(groupRows, sort).map((r) => <Row key={`${r.platform}:${r.campaign_id}`} row={r} />)}
            </tbody>
            <tfoot>
              {subtotalsByCurrency(groupRows).map((s) => (
                <tr key={s.currency} className="bg-slate-50 font-medium">
                  <td colSpan={6} className="px-3 py-2 text-right text-slate-500">Subtotal ({s.currency})</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatSpend(s.total, s.currency)}</td>
                  <td />
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      ))}
    </div>
  );
}
