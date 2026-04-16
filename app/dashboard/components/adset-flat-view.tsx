'use client';

import { Fragment, useMemo, useState } from 'react';
import { roasColorClass, formatRoas, formatProfit } from '@/lib/adjust/merge';
import type { BudgetTarget, MergedAdSet, SnapshotAdSetRow, SnapshotComparison } from '@/lib/types';
import BudgetModal from './budget-modal';

function fmtUsd(v: number | null) {
  if (v === null || v === 0) return '—';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDelta(v: number | null) {
  if (v === null) return '—';
  return `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** MergedAdSet enriched with campaign_name for the flat view */
export interface FlatAdSet extends MergedAdSet {
  campaign_name: string;
}

type SortCol = 'spend' | 'roas' | 'profit_pct' | 'profit' | 'adjust_revenue' | 'cpm' | 'ctr' | 'budget';

interface Props {
  adsets: FlatAdSet[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  vndRate: number;
  showAccountColumn: boolean;
  /** Ordered snapshot comparisons. Empty array = no snapshot selected. */
  snapshotComparisons: SnapshotComparison[];
  zoom?: number;
}

export default function AdsetFlatView({ adsets, selectedIds, onSelectionChange, vndRate, showAccountColumn, snapshotComparisons, zoom = 100 }: Props) {
  const [budgetTarget, setBudgetTarget] = useState<BudgetTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [sortCol, setSortCol] = useState<SortCol>('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function handleSort(col: SortCol) {
    if (col === sortCol) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('desc'); }
  }

  function sortArrow(col: SortCol) {
    if (col !== sortCol) return <span className="ml-0.5 text-slate-300">↕</span>;
    return <span className="ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  function budgetVal(a: FlatAdSet): number {
    return a.budget_type === 'cbo' ? 0 : (a.daily_budget ?? a.lifetime_budget ?? 0);
  }

  const sortedAdsets = useMemo(() => {
    return [...adsets].sort((a, b) => {
      const av = sortCol === 'budget' ? budgetVal(a) : ((a[sortCol] as number | null) ?? 0);
      const bv = sortCol === 'budget' ? budgetVal(b) : ((b[sortCol] as number | null) ?? 0);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adsets, sortCol, sortDir]);

  const allSelected = adsets.length > 0 && adsets.every((a) => selectedIds.has(a.adset_id));

  function toggleAll() {
    onSelectionChange(allSelected ? new Set() : new Set(adsets.map((a) => a.adset_id)));
  }
  function toggleOne(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectionChange(next);
  }

  async function handleBudgetConfirm(amount: number, currency: string) {
    if (!budgetTarget) return;
    const target = budgetTarget;
    setBudgetTarget(null);
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch(`/api/adsets/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'budget', budget_type: target.budget_type, amount, currency }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Budget update failed');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Budget update failed');
    } finally {
      setSaving(false);
    }
  }

  // ── Subtotals ────────────────────────────────────────────────────────────────
  const totalSpend = sortedAdsets.reduce((s, a) => s + a.spend, 0);
  const totalRevenue = sortedAdsets.reduce((s, a) => s + (a.adjust_revenue ?? 0), 0);
  const totalAllRevenue = sortedAdsets.reduce((s, a) => s + (a.adjust_all_revenue ?? 0), 0);
  const totalProfit = sortedAdsets.reduce((s, a) => s + (a.profit ?? 0), 0);
  const avgRoas = totalSpend > 0 && totalRevenue > 0 ? totalRevenue / totalSpend : null;
  const avgProfitPct = totalAllRevenue > 0 ? (totalAllRevenue - totalSpend) / totalAllRevenue * 100 : null;
  const matchedCount = sortedAdsets.filter((a) => a.has_adjust_data).length;

  /** Compute per-snapshot subtotals for the subtotal row */
  function snapSubtotals(comp: SnapshotComparison) {
    const totalSnap = sortedAdsets.reduce((s, a) => s + (comp.adsetMap.get(a.adset_id)?.spend ?? 0), 0);
    const totalSnapRev = sortedAdsets.reduce((s, a) => s + (comp.adsetMap.get(a.adset_id)?.adjust_revenue ?? 0), 0);
    // Weighted ROAS = Σ(snap_revenue) / Σ(snap_spend) — same method as the live subtotal
    const avgSnapRoas = totalSnap > 0 && totalSnapRev > 0 ? totalSnapRev / totalSnap : null;
    // %Profit subtotal = (Σall_revenue − Σspend) / Σall_revenue; derive all_revenue = profit + spend
    const snapForPct = sortedAdsets.filter((a) => {
      const snap = comp.adsetMap.get(a.adset_id);
      return snap?.profit != null && snap?.spend != null;
    });
    const snapProfitSum = snapForPct.reduce((s, a) => s + comp.adsetMap.get(a.adset_id)!.profit!, 0);
    const snapAllRevSum = snapForPct.reduce((s, a) => {
      const snap = comp.adsetMap.get(a.adset_id)!;
      return s + snap.profit! + snap.spend!;
    }, 0);
    const avgSnapPct = snapAllRevSum > 0 ? (snapProfitSum / snapAllRevSum) * 100 : null;
    const snapWithProfit = sortedAdsets.filter((a) => comp.adsetMap.get(a.adset_id)?.profit != null);
    const totalSnapProfit = snapWithProfit.length > 0
      ? snapWithProfit.reduce((s, a) => s + comp.adsetMap.get(a.adset_id)!.profit!, 0)
      : null;
    // "Previous" totals for delta (null prevAdsetMap = compare against current live totals)
    const prevTotalSpend = comp.prevAdsetMap
      ? sortedAdsets.reduce((s, a) => s + (comp.prevAdsetMap!.get(a.adset_id)?.spend ?? 0), 0)
      : totalSpend;
    const prevTotalRev = comp.prevAdsetMap
      ? sortedAdsets.reduce((s, a) => s + (comp.prevAdsetMap!.get(a.adset_id)?.adjust_revenue ?? 0), 0)
      : totalRevenue;
    const deltaSpend = prevTotalSpend - totalSnap;
    const deltaRev = prevTotalRev - totalSnapRev;
    const prevWithRoas = comp.prevAdsetMap
      ? sortedAdsets.filter((a) => comp.prevAdsetMap!.get(a.adset_id)?.roas != null && comp.adsetMap.get(a.adset_id)?.roas != null)
      : sortedAdsets.filter((a) => a.roas != null && comp.adsetMap.get(a.adset_id)?.roas != null);
    const avgDeltaRoas = prevWithRoas.length > 0
      ? prevWithRoas.reduce((s, a) => {
        const prevR = comp.prevAdsetMap ? (comp.prevAdsetMap.get(a.adset_id)?.roas ?? 0) : (a.roas ?? 0);
        return s + prevR - comp.adsetMap.get(a.adset_id)!.roas!;
      }, 0) / prevWithRoas.length
      : null;
    // Δ%Profit = prevPct − snapPct, both computed as aggregates (not per-row averages)
    let prevPctForDelta: number | null;
    if (comp.prevAdsetMap) {
      const prevForPct = sortedAdsets.filter((a) => {
        const prev = comp.prevAdsetMap!.get(a.adset_id);
        return prev?.profit != null && prev?.spend != null;
      });
      const prevProfitSum = prevForPct.reduce((s, a) => s + comp.prevAdsetMap!.get(a.adset_id)!.profit!, 0);
      const prevAllRevSum = prevForPct.reduce((s, a) => {
        const prev = comp.prevAdsetMap!.get(a.adset_id)!;
        return s + prev.profit! + prev.spend!;
      }, 0);
      prevPctForDelta = prevAllRevSum > 0 ? (prevProfitSum / prevAllRevSum) * 100 : null;
    } else {
      prevPctForDelta = avgProfitPct;
    }
    const avgDeltaPct = prevPctForDelta !== null && avgSnapPct !== null ? prevPctForDelta - avgSnapPct : null;
    const prevWithProfit = comp.prevAdsetMap
      ? sortedAdsets.filter((a) => comp.prevAdsetMap!.get(a.adset_id)?.profit != null && comp.adsetMap.get(a.adset_id)?.profit != null)
      : sortedAdsets.filter((a) => a.profit != null && comp.adsetMap.get(a.adset_id)?.profit != null);
    const totalDeltaProfit = prevWithProfit.length > 0
      ? prevWithProfit.reduce((s, a) => {
        const prevP = comp.prevAdsetMap ? (comp.prevAdsetMap.get(a.adset_id)?.profit ?? 0) : (a.profit ?? 0);
        return s + prevP - comp.adsetMap.get(a.adset_id)!.profit!;
      }, 0)
      : null;
    return { totalSnap, totalSnapRev, avgSnapRoas, avgSnapPct, totalSnapProfit, deltaSpend, deltaRev, avgDeltaRoas, avgDeltaPct, totalDeltaProfit };
  }

  /** Render snapshot data + delta cells for a single adset row */
  function renderAdsetSnapCols(a: FlatAdSet, comp: SnapshotComparison) {
    const snap = comp.adsetMap.get(a.adset_id) ?? null;
    const getPrev = (field: keyof SnapshotAdSetRow): number | null => {
      if (!comp.prevAdsetMap) return (a as unknown as Record<string, number | null>)[field as string] as number | null;
      return (comp.prevAdsetMap.get(a.adset_id)?.[field] ?? null) as number | null;
    };
    const deltaSpend = snap?.spend != null ? (getPrev('spend') ?? a.spend) - snap.spend : null;
    const deltaRev = snap?.adjust_revenue != null && getPrev('adjust_revenue') != null
      ? (getPrev('adjust_revenue') ?? 0) - snap.adjust_revenue : null;
    const deltaRoas = snap?.roas != null && getPrev('roas') != null
      ? (getPrev('roas') ?? 0) - snap.roas : null;
    const deltaPct = snap?.profit_pct != null && getPrev('profit_pct') != null
      ? (getPrev('profit_pct') ?? 0) - snap.profit_pct : null;
    const deltaProfit = snap?.profit != null && getPrev('profit') != null
      ? (getPrev('profit') ?? 0) - snap.profit : null;
    return (
      <>
        <td className="px-3 py-2.5 text-right tabular-nums bg-amber-50/40 border-l border-amber-100 text-xs text-slate-700">
          {snap?.spend != null ? fmtUsd(snap.spend) : <span className="text-slate-300">—</span>}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums bg-amber-50/40 text-xs text-slate-500">
          {snap?.cpm != null ? fmtUsd(snap.cpm) : <span className="text-slate-300">—</span>}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums bg-amber-50/40 text-xs text-slate-500">
          {snap?.ctr != null && snap.ctr > 0 ? `${snap.ctr.toFixed(2)}%` : <span className="text-slate-300">—</span>}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums bg-amber-50/40 text-xs text-slate-700">
          {snap?.adjust_revenue != null ? fmtUsd(snap.adjust_revenue) : <span className="text-slate-300">—</span>}
        </td>
        <td className={`px-3 py-2.5 text-right tabular-nums bg-amber-50/40 text-xs font-semibold ${roasColorClass(snap?.roas ?? null)}`}>
          {snap ? formatRoas(snap.roas) : <span className="text-slate-300">—</span>}
        </td>
        <td className={`px-3 py-2.5 text-right tabular-nums bg-amber-50/40 text-xs font-medium ${snap?.profit_pct == null ? 'text-slate-300' : snap.profit_pct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {snap?.profit_pct != null ? formatProfit(snap.profit_pct) : '—'}
        </td>
        <td className={`px-3 py-2.5 text-right tabular-nums bg-amber-50/40 text-xs font-medium ${snap?.profit == null ? 'text-slate-300' : snap.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {snap?.profit != null ? fmtUsd(snap.profit) : '—'}
        </td>
        <td className={`px-3 py-2.5 text-right tabular-nums bg-sky-50/40 border-l border-sky-100 text-xs font-semibold ${deltaSpend === null ? 'text-slate-300' : deltaSpend >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {fmtDelta(deltaSpend)}
        </td>
        <td className={`px-3 py-2.5 text-right tabular-nums bg-sky-50/40 text-xs font-semibold ${deltaRev === null ? 'text-slate-300' : deltaRev >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {fmtDelta(deltaRev)}
        </td>
        <td className={`px-3 py-2.5 text-right tabular-nums bg-sky-50/40 text-xs font-semibold ${deltaRoas === null ? 'text-slate-300' : deltaRoas >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {deltaRoas !== null ? `${deltaRoas >= 0 ? '+' : ''}${deltaRoas.toFixed(2)}x` : '—'}
        </td>
        <td className={`px-3 py-2.5 text-right tabular-nums bg-sky-50/40 text-xs font-semibold ${deltaPct === null ? 'text-slate-300' : deltaPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {deltaPct !== null ? `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%` : '—'}
        </td>
        <td className={`px-3 py-2.5 text-right tabular-nums bg-sky-50/40 text-xs font-semibold ${deltaProfit === null ? 'text-slate-300' : deltaProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {fmtDelta(deltaProfit)}
        </td>
      </>
    );
  }

  if (adsets.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-400">
        No ad sets found. Try expanding campaigns first or check your filters.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex-1 min-h-0 overflow-x-scroll overflow-y-scroll" style={{ scrollbarGutter: 'stable' }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0, ...(zoom !== 100 ? { zoom: zoom / 100 } : {}) }}>
          <thead className="sticky top-0 z-10" style={{ boxShadow: '0 3px 10px rgba(0,0,0,0.12)' }}>
            {/* Group header row */}
            <tr>
              <th className="sticky left-0 z-20 bg-slate-100 w-10 border-b border-slate-300" />
              <th className="sticky left-10 z-20 bg-slate-100 border-r border-slate-300 border-b border-slate-300" />
              <th colSpan={showAccountColumn ? 6 : 5} className="px-3 py-1.5 text-center text-xs font-semibold text-blue-700 bg-blue-50 border-r border-blue-200 border-b border-blue-200 tracking-wide uppercase">
                Facebook Ads Data
              </th>
              <th className="px-3 py-1.5 text-center text-xs font-semibold text-emerald-700 bg-emerald-50 border-r border-emerald-200 border-b border-emerald-200 tracking-wide uppercase">
                Adjust CSV
              </th>
              <th colSpan={4} className="px-3 py-1.5 text-center text-xs font-semibold text-purple-700 bg-purple-50 border-b border-purple-200 tracking-wide uppercase">
                Result
              </th>
              {snapshotComparisons.map((comp, i) => (
                <Fragment key={comp.id}>
                  <th colSpan={7} className="px-3 py-1.5 text-center text-xs font-semibold text-amber-700 bg-amber-50 border-l border-amber-200 border-b border-amber-200 tracking-wide uppercase whitespace-nowrap">
                    #{i + 1} {comp.name}
                  </th>
                  <th colSpan={5} className="px-3 py-1.5 text-center text-xs font-semibold text-sky-700 bg-sky-50 border-l border-sky-200 border-b border-sky-200 tracking-wide uppercase whitespace-nowrap">
                    Δ vs {i === snapshotComparisons.length - 1 ? 'Current' : `#${i + 2}`}
                  </th>
                </Fragment>
              ))}
            </tr>

            {/* Column header row */}
            <tr className="bg-slate-100 text-slate-600 font-semibold">
              <th className="sticky left-0 z-20 w-10 px-4 py-2.5 border-b border-slate-300 bg-slate-100">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-slate-300 bg-white h-5 w-5 cursor-pointer" />
              </th>
              <th className="sticky left-10 z-20 px-3 py-2.5 text-left whitespace-nowrap border-r border-slate-300 border-b border-slate-300 bg-slate-100">Ad Set / Campaign</th>
              {showAccountColumn && <th className="px-3 py-2.5 text-left whitespace-nowrap bg-blue-100 border-b border-blue-200">Account</th>}
              <th className="px-3 py-2.5 text-left whitespace-nowrap bg-blue-100 border-b border-blue-200">Status</th>
              <th onClick={() => handleSort('spend')} className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-100 border-b border-blue-200 cursor-pointer hover:bg-blue-200 select-none">Spend{sortArrow('spend')}</th>
              <th onClick={() => handleSort('cpm')} className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-100 border-b border-blue-200 cursor-pointer hover:bg-blue-200 select-none">CPM{sortArrow('cpm')}</th>
              <th onClick={() => handleSort('ctr')} className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-100 border-b border-blue-200 cursor-pointer hover:bg-blue-200 select-none">CTR (all){sortArrow('ctr')}</th>
              <th onClick={() => handleSort('budget')} className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-100 border-r border-blue-200 border-b border-blue-200 cursor-pointer hover:bg-blue-200 select-none">Budget{sortArrow('budget')}</th>
              <th onClick={() => handleSort('adjust_revenue')} className="px-3 py-2.5 text-right whitespace-nowrap bg-emerald-100 border-r border-emerald-200 border-b border-emerald-200 cursor-pointer hover:bg-emerald-200 select-none">Revenue{sortArrow('adjust_revenue')}</th>
              <th className="px-3 py-2.5 text-center whitespace-nowrap bg-purple-100 border-b border-purple-200">ID Match</th>
              <th onClick={() => handleSort('roas')} className="px-3 py-2.5 text-right whitespace-nowrap bg-purple-100 border-b border-purple-200 cursor-pointer hover:bg-purple-200 select-none">D0 ROAS{sortArrow('roas')}</th>
              <th onClick={() => handleSort('profit_pct')} className="px-3 py-2.5 text-right whitespace-nowrap bg-purple-100 border-b border-purple-200 cursor-pointer hover:bg-purple-200 select-none">%Profit{sortArrow('profit_pct')}</th>
              <th onClick={() => handleSort('profit')} className="px-3 py-2.5 text-right whitespace-nowrap bg-purple-100 border-b border-purple-200 cursor-pointer hover:bg-purple-200 select-none">Profit{sortArrow('profit')}</th>
              {snapshotComparisons.map((comp) => (
                <Fragment key={comp.id}>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap bg-amber-100 border-l border-amber-200 border-b border-amber-200 text-xs">Old Spend</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap bg-amber-100 border-b border-amber-200 text-xs">Old CPM</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap bg-amber-100 border-b border-amber-200 text-xs">Old CTR</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap bg-amber-100 border-b border-amber-200 text-xs">Old Revenue</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap bg-amber-100 border-b border-amber-200 text-xs">Old ROAS</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap bg-amber-100 border-b border-amber-200 text-xs">Old %Profit</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap bg-amber-100 border-b border-amber-200 text-xs">Old Profit</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap bg-sky-100 border-l border-sky-200 border-b border-sky-200 text-xs">Δ Spend</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap bg-sky-100 border-b border-sky-200 text-xs">Δ Revenue</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap bg-sky-100 border-b border-sky-200 text-xs">Δ ROAS</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap bg-sky-100 border-b border-sky-200 text-xs">Δ %Profit</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap bg-sky-100 border-b border-sky-200 text-xs">Δ Profit</th>
                </Fragment>
              ))}
            </tr>

            {/* Subtotal row */}
            <tr className="bg-slate-100 text-sm font-semibold text-slate-700">
              <th className="sticky left-0 z-20 w-10 px-4 py-2 border-b-2 border-slate-400 bg-slate-100" />
              <th className="sticky left-10 z-20 px-3 py-2 text-left text-slate-500 font-medium border-r border-slate-300 border-b-2 border-slate-400 whitespace-nowrap bg-slate-100">
                {sortedAdsets.length} ad sets · {matchedCount} matched
              </th>
              {showAccountColumn && <th className="px-3 py-2 bg-blue-100 border-b-2 border-blue-300" />}
              <th className="px-3 py-2 bg-blue-100 border-b-2 border-blue-300" />
              <th className="px-3 py-2 text-right tabular-nums bg-blue-100 border-b-2 border-blue-300">{fmtUsd(totalSpend)}</th>
              <th className="px-3 py-2 text-right text-slate-400 bg-blue-100 border-b-2 border-blue-300">—</th>
              <th className="px-3 py-2 text-right text-slate-400 bg-blue-100 border-b-2 border-blue-300">—</th>
              <th className="px-3 py-2 text-right text-slate-400 bg-blue-100 border-r border-blue-200 border-b-2 border-blue-300">—</th>
              <th className="px-3 py-2 text-right tabular-nums bg-emerald-100 text-emerald-700 border-r border-emerald-200 border-b-2 border-emerald-300">
                {totalRevenue > 0 ? fmtUsd(totalRevenue) : <span className="text-slate-400">—</span>}
              </th>
              <th className="px-3 py-2 text-center text-slate-400 bg-purple-100 border-b-2 border-purple-300">—</th>
              <th className={`px-3 py-2 text-right tabular-nums bg-purple-100 border-b-2 border-purple-300 ${avgRoas === null ? 'text-slate-400' : avgRoas >= 2 ? 'text-emerald-600' : avgRoas >= 1 ? 'text-amber-600' : 'text-red-600'}`}>
                {avgRoas !== null ? `${avgRoas.toFixed(2)}x` : '—'}
              </th>
              <th className={`px-3 py-2 text-right tabular-nums bg-purple-100 border-b-2 border-purple-300 ${avgProfitPct === null ? 'text-slate-400' : avgProfitPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {avgProfitPct !== null ? `${avgProfitPct >= 0 ? '+' : ''}${avgProfitPct.toFixed(1)}%` : '—'}
              </th>
              <th className={`px-3 py-2 text-right tabular-nums bg-purple-100 border-b-2 border-purple-300 ${totalProfit === 0 ? 'text-slate-400' : totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {totalRevenue > 0 ? fmtUsd(totalProfit) : <span className="text-slate-400">—</span>}
              </th>
              {snapshotComparisons.map((comp) => {
                const st = snapSubtotals(comp);
                return (
                  <>
                    <th key={`st-spend-${comp.id}`} className="px-3 py-2 text-right tabular-nums bg-amber-100 border-l border-amber-200 border-b-2 border-amber-300 text-xs font-semibold text-slate-700">
                      {st.totalSnap > 0 ? fmtUsd(st.totalSnap) : '—'}
                    </th>
                    <th key={`st-cpm-${comp.id}`} className="px-3 py-2 text-right bg-amber-100 border-b-2 border-amber-300 text-xs text-slate-400">—</th>
                    <th key={`st-ctr-${comp.id}`} className="px-3 py-2 text-right bg-amber-100 border-b-2 border-amber-300 text-xs text-slate-400">—</th>
                    <th key={`st-rev-${comp.id}`} className="px-3 py-2 text-right tabular-nums bg-amber-100 border-b-2 border-amber-300 text-xs font-semibold text-emerald-700">
                      {st.totalSnapRev > 0 ? fmtUsd(st.totalSnapRev) : '—'}
                    </th>
                    <th key={`st-roas-${comp.id}`} className={`px-3 py-2 text-right tabular-nums bg-amber-100 border-b-2 border-amber-300 text-xs font-semibold ${st.avgSnapRoas === null ? 'text-slate-400' : st.avgSnapRoas >= 2 ? 'text-emerald-600' : st.avgSnapRoas >= 1 ? 'text-amber-600' : 'text-red-600'}`}>
                      {st.avgSnapRoas !== null ? `${st.avgSnapRoas.toFixed(2)}x` : '—'}
                    </th>
                    <th key={`st-pct-${comp.id}`} className={`px-3 py-2 text-right tabular-nums bg-amber-100 border-b-2 border-amber-300 text-xs font-semibold ${st.avgSnapPct === null ? 'text-slate-400' : st.avgSnapPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {st.avgSnapPct !== null ? `${st.avgSnapPct >= 0 ? '+' : ''}${st.avgSnapPct.toFixed(1)}%` : '—'}
                    </th>
                    <th key={`st-prf-${comp.id}`} className={`px-3 py-2 text-right tabular-nums bg-amber-100 border-b-2 border-amber-300 text-xs font-semibold ${st.totalSnapProfit === null ? 'text-slate-400' : st.totalSnapProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {st.totalSnapProfit !== null ? fmtUsd(st.totalSnapProfit) : '—'}
                    </th>
                    <th key={`sd-spend-${comp.id}`} className={`px-3 py-2 text-right tabular-nums bg-sky-100 border-l border-sky-200 border-b-2 border-sky-300 text-xs font-semibold ${st.deltaSpend >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {fmtDelta(st.deltaSpend)}
                    </th>
                    <th key={`sd-rev-${comp.id}`} className={`px-3 py-2 text-right tabular-nums bg-sky-100 border-b-2 border-sky-300 text-xs font-semibold ${st.deltaRev >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {fmtDelta(st.deltaRev)}
                    </th>
                    <th key={`sd-roas-${comp.id}`} className={`px-3 py-2 text-right tabular-nums bg-sky-100 border-b-2 border-sky-300 text-xs font-semibold ${st.avgDeltaRoas === null ? 'text-slate-400' : st.avgDeltaRoas >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {st.avgDeltaRoas !== null ? `${st.avgDeltaRoas >= 0 ? '+' : ''}${st.avgDeltaRoas.toFixed(2)}x` : '—'}
                    </th>
                    <th key={`sd-pct-${comp.id}`} className={`px-3 py-2 text-right tabular-nums bg-sky-100 border-b-2 border-sky-300 text-xs font-semibold ${st.avgDeltaPct === null ? 'text-slate-400' : st.avgDeltaPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {st.avgDeltaPct !== null ? `${st.avgDeltaPct >= 0 ? '+' : ''}${st.avgDeltaPct.toFixed(1)}%` : '—'}
                    </th>
                    <th key={`sd-prf-${comp.id}`} className={`px-3 py-2 text-right tabular-nums bg-sky-100 border-b-2 border-sky-300 text-xs font-semibold ${st.totalDeltaProfit === null ? 'text-slate-400' : st.totalDeltaProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {st.totalDeltaProfit !== null ? fmtDelta(st.totalDeltaProfit) : '—'}
                    </th>
                  </>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {sortedAdsets.map((a) => {
              const budgetAmount = a.budget_type === 'daily' ? a.daily_budget : a.budget_type === 'lifetime' ? a.lifetime_budget : null;
              const isSelected = selectedIds.has(a.adset_id);
              const isActive = a.effective_status === 'ACTIVE';
              return (
                <tr key={a.adset_id} className={`group hover:bg-slate-50 transition-colors ${isSelected ? 'bg-indigo-50' : ''}`}>
                  <td className={`sticky left-0 z-[1] px-4 py-2.5 ${isSelected ? 'bg-indigo-50' : 'bg-white group-hover:bg-slate-50'}`}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleOne(a.adset_id)} className="rounded border-slate-300 bg-white h-5 w-5 cursor-pointer" />
                  </td>
                  <td className={`sticky left-10 z-[1] px-3 py-2.5 max-w-xs border-r border-slate-100 ${isSelected ? 'bg-indigo-50' : 'bg-white group-hover:bg-slate-50'}`}>
                    <div className="font-medium text-slate-900 truncate" title={a.adset_name}>{a.adset_name}</div>
                    <div className="text-xs text-slate-400 font-mono">{a.adset_id}</div>
                    <div className="text-xs text-slate-500 truncate mt-0.5" title={a.campaign_name}>↳ {a.campaign_name}</div>
                  </td>
                  {showAccountColumn && (
                    <td className="px-3 py-2.5 bg-blue-50/40">
                      <span className="text-xs text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">{a.account_name}</span>
                    </td>
                  )}
                  <td className="px-3 py-2.5 bg-blue-50/40">
                    {isActive
                      ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">Active</span>
                      : <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Paused</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 bg-blue-50/40">{fmtUsd(a.spend)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 bg-blue-50/40">{fmtUsd(a.cpm)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 bg-blue-50/40">
                    {a.ctr > 0 ? `${a.ctr.toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right bg-blue-50/40 border-r border-blue-100">
                    {a.budget_type === 'cbo' ? (
                      <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-medium">CBO</span>
                    ) : (
                      <div className="flex items-center justify-end gap-1.5 tabular-nums text-slate-700">
                        <span>{fmtUsd(budgetAmount)}</span>
                        <span className="text-slate-400 text-xs">{a.budget_type === 'daily' ? '/d' : ' lt'}</span>
                        {saving ? (
                          <span className="text-slate-400 text-xs">…</span>
                        ) : (
                          <button
                            onClick={() => setBudgetTarget({ id: a.adset_id, name: a.adset_name, budget_type: a.budget_type, daily_budget: a.daily_budget, lifetime_budget: a.lifetime_budget, entity_type: 'adset', currency: a.currency, vndRate })}
                            className="text-indigo-500 hover:text-indigo-700 transition-colors text-xs"
                            title="Edit budget"
                          >✎</button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 bg-emerald-50/40 border-r border-emerald-100">
                    {a.has_adjust_data ? fmtUsd(a.adjust_revenue) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center bg-purple-50/40">
                    {a.has_adjust_data
                      ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">✓</span>
                      : <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">✗</span>}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-semibold tabular-nums bg-purple-50/40 ${roasColorClass(a.roas)}`}>
                    {formatRoas(a.roas)}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums bg-purple-50/40 ${a.profit_pct === null ? 'text-slate-300' : a.profit_pct >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}`}>
                    {formatProfit(a.profit_pct)}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums bg-purple-50/40 font-medium ${a.profit === null ? 'text-slate-300' : a.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {a.profit !== null ? fmtUsd(a.profit) : '—'}
                  </td>
                  {snapshotComparisons.map((comp) => <Fragment key={comp.id}>{renderAdsetSnapCols(a, comp)}</Fragment>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {saveError && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-200 text-xs text-red-600 flex items-center justify-between">
          <span>{saveError}</span>
          <button onClick={() => setSaveError('')} className="text-red-400 hover:text-red-700 ml-4">✕</button>
        </div>
      )}

      {budgetTarget && (
        <BudgetModal target={budgetTarget} onConfirm={handleBudgetConfirm} onClose={() => setBudgetTarget(null)} />
      )}
    </div>
  );
}
