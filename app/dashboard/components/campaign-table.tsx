'use client';

import { Fragment, useState } from 'react';
import { mergeAdSets, roasColorClass, formatRoas, formatProfit } from '@/lib/adjust/merge';
import type { AdSetRow, BudgetTarget, MergedCampaign, SnapshotComparison, SnapshotRow } from '@/lib/types';
import AdSetRows from './adset-rows';
import BudgetModal from './budget-modal';

function fmtUsd(v: number | null) {
  if (v === null || v === 0) return '—';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(v: number | null) {
  if (v === null) return '—';
  return v.toLocaleString('en-US');
}

function SortBtn({ col, sortCol, sortDir, onSort }: {
  col: keyof MergedCampaign; sortCol: keyof MergedCampaign;
  sortDir: 'asc' | 'desc'; onSort: (c: keyof MergedCampaign) => void;
}) {
  return (
    <button onClick={() => onSort(col)} className="hover:text-slate-800 select-none">
      {col === sortCol ? (sortDir === 'asc' ? ' ↑' : ' ↓') : <span className="text-slate-400"> ↕</span>}
    </button>
  );
}

interface Props {
  campaigns: MergedCampaign[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  sortCol: keyof MergedCampaign;
  sortDir: 'asc' | 'desc';
  onSort: (col: keyof MergedCampaign) => void;
  showAccountColumn?: boolean;
  adjustAdSetMap: Map<string, number>;
  adjustAllRevAdSetMap: Map<string, number>;
  vndRate: number;
  /** Ordered snapshot comparisons. Empty array = no snapshot selected. */
  snapshotComparisons: SnapshotComparison[];
  zoom?: number;
}

export default function CampaignTable({
  campaigns, selectedIds, onSelectionChange, sortCol, sortDir, onSort,
  showAccountColumn = false, adjustAdSetMap, adjustAllRevAdSetMap, vndRate,
  snapshotComparisons, zoom = 100,
}: Props) {
  const allSelected = campaigns.length > 0 && campaigns.every((c) => selectedIds.has(c.campaign_id));

  // Expansion state — raw AdSetRow[] cached so re-merge applies when vndRate changes
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [adSetCache, setAdSetCache] = useState<Map<string, AdSetRow[]>>(new Map());
  const [loadingAdSets, setLoadingAdSets] = useState<Set<string>>(new Set());
  const [adSetErrors, setAdSetErrors] = useState<Map<string, string>>(new Map());

  // Inline campaign budget edit
  const [campaignBudgetTarget, setCampaignBudgetTarget] = useState<BudgetTarget | null>(null);
  const [campaignBudgetError, setCampaignBudgetError] = useState('');
  const [budgetSuccessMsg, setBudgetSuccessMsg] = useState('');

  function toggleAll() {
    onSelectionChange(allSelected ? new Set() : new Set(campaigns.map((c) => c.campaign_id)));
  }
  function toggleOne(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectionChange(next);
  }

  async function handleToggleExpand(c: MergedCampaign) {
    const id = c.campaign_id;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); return next; }
      next.add(id);
      return next;
    });
    if (adSetCache.has(id)) return; // already cached

    setLoadingAdSets((prev) => new Set([...prev, id]));
    setAdSetErrors((prev) => { const m = new Map(prev); m.delete(id); return m; });
    try {
      const url = `/api/campaigns/${id}/adsets?accountId=${encodeURIComponent(c.account_id)}&accountName=${encodeURIComponent(c.account_name)}&currency=${encodeURIComponent(c.currency)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load ad sets');
      // Store raw adsets — merged on render so vndRate changes auto-apply
      setAdSetCache((prev) => new Map([...prev, [id, data.adsets as AdSetRow[]]]));
    } catch (err) {
      setAdSetErrors((prev) => new Map([...prev, [id, err instanceof Error ? err.message : 'Error']]));
    } finally {
      setLoadingAdSets((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }

  async function handleCampaignBudgetConfirm(amount: number, currency: string) {
    if (!campaignBudgetTarget) return;
    const target = campaignBudgetTarget;
    setCampaignBudgetTarget(null);
    setCampaignBudgetError('');
    try {
      const res = await fetch(`/api/campaigns/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'budget', budget_type: target.budget_type, amount, currency }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Budget update failed');
    } catch (err) {
      setCampaignBudgetError(err instanceof Error ? err.message : 'Budget update failed');
    }
  }

  async function refetchAdSets(c: MergedCampaign) {
    const id = c.campaign_id;
    setBudgetSuccessMsg('Budget updated — refreshing ad sets…');
    try {
      const url = `/api/campaigns/${id}/adsets?accountId=${encodeURIComponent(c.account_id)}&accountName=${encodeURIComponent(c.account_name)}&currency=${encodeURIComponent(c.currency)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      setAdSetCache((prev) => new Map([...prev, [id, data.adsets as AdSetRow[]]]));
      setBudgetSuccessMsg('Budget updated successfully!');
    } catch {
      setBudgetSuccessMsg('Budget saved — reload to see updated values.');
    }
    setTimeout(() => setBudgetSuccessMsg(''), 4000);
  }

  if (campaigns.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-400">
        No campaigns match the current filter.
      </div>
    );
  }

  const fbColSpan = showAccountColumn ? 6 : 5; // Account? + Status + Spend + CPM + CTR + Budget
  const hasSnapshot = snapshotComparisons.length > 0;
  // Result group: ID Match + D0 ROAS + %Profit + Profit = 4 cols
  // Per snapshot: Old Spend/CPM/CTR/Revenue/ROAS/%Profit/Profit(7) + Δ Spend/Revenue/ROAS/%Profit/Profit(5) = 12 cols
  const colCount = 2 + fbColSpan + 1 + 4 + (snapshotComparisons.length * 12);

  // Subtotals computed from visible campaigns
  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
  // adjust_revenue = cohort_all_revenue → D0 ROAS numerator
  const totalRevenue = campaigns.reduce((s, c) => s + (c.adjust_revenue ?? 0), 0);
  // adjust_all_revenue → %Profit / Profit denominator
  const totalAllRevenue = campaigns.reduce((s, c) => s + (c.adjust_all_revenue ?? 0), 0);
  const totalProfit = campaigns.reduce((s, c) => s + (c.profit ?? 0), 0);
  // Weighted: D0 ROAS = Σcohort_all_revenue / Σspend (only when there is spend and Adjust data)
  const avgRoas = totalSpend > 0 && totalRevenue > 0 ? totalRevenue / totalSpend : null;
  // Weighted: %Profit = (Σall_revenue − Σspend) / Σall_revenue × 100
  const avgProfitPct = totalAllRevenue > 0 ? (totalAllRevenue - totalSpend) / totalAllRevenue * 100 : null;
  const matchedCount = campaigns.filter((c) => c.has_adjust_data).length;

  /** Compute subtotals for one snapshot comparison entry (for the subtotal row) */
  function snapSubtotals(comp: SnapshotComparison) {
    const totalSnap = campaigns.reduce((s, c) => s + (comp.campaignMap.get(c.campaign_id)?.spend ?? 0), 0);
    const totalSnapRev = campaigns.reduce((s, c) => s + (comp.campaignMap.get(c.campaign_id)?.adjust_revenue ?? 0), 0);
    // Weighted ROAS = Σ(snap_revenue) / Σ(snap_spend) — same method as the live subtotal
    const avgSnapRoas = totalSnap > 0 && totalSnapRev > 0 ? totalSnapRev / totalSnap : null;
    // %Profit subtotal = (Σall_revenue − Σspend) / Σall_revenue; derive all_revenue = profit + spend
    const snapForPct = campaigns.filter((c) => {
      const snap = comp.campaignMap.get(c.campaign_id);
      return snap?.profit != null && snap?.spend != null;
    });
    const snapProfitSum = snapForPct.reduce((s, c) => s + comp.campaignMap.get(c.campaign_id)!.profit!, 0);
    const snapAllRevSum = snapForPct.reduce((s, c) => {
      const snap = comp.campaignMap.get(c.campaign_id)!;
      return s + snap.profit! + snap.spend!;
    }, 0);
    const avgSnapPct = snapAllRevSum > 0 ? (snapProfitSum / snapAllRevSum) * 100 : null;
    const snapWithProfit = campaigns.filter((c) => comp.campaignMap.get(c.campaign_id)?.profit != null);
    const totalSnapProfit = snapWithProfit.length > 0
      ? snapWithProfit.reduce((s, c) => s + comp.campaignMap.get(c.campaign_id)!.profit!, 0) : null;
    // "Previous" = current live if prevCampaignMap is null, else prev snapshot
    const prevTotalSpend = comp.prevCampaignMap
      ? campaigns.reduce((s, c) => s + (comp.prevCampaignMap!.get(c.campaign_id)?.spend ?? 0), 0) : totalSpend;
    const prevTotalRev = comp.prevCampaignMap
      ? campaigns.reduce((s, c) => s + (comp.prevCampaignMap!.get(c.campaign_id)?.adjust_revenue ?? 0), 0) : totalRevenue;
    const deltaSpend = prevTotalSpend - totalSnap;
    const deltaRev = prevTotalRev - totalSnapRev;
    const roasPairs = campaigns.filter((c) => {
      const snapR = comp.campaignMap.get(c.campaign_id)?.roas;
      const prevR = comp.prevCampaignMap ? comp.prevCampaignMap.get(c.campaign_id)?.roas : c.roas;
      return snapR != null && prevR != null;
    });
    const avgDeltaRoas = roasPairs.length > 0
      ? roasPairs.reduce((s, c) => {
        const prevR = comp.prevCampaignMap ? (comp.prevCampaignMap.get(c.campaign_id)?.roas ?? 0) : (c.roas ?? 0);
        return s + prevR - comp.campaignMap.get(c.campaign_id)!.roas!;
      }, 0) / roasPairs.length : null;
    // Δ%Profit = prevPct − snapPct, both computed as aggregates (not per-row averages)
    let prevPctForDelta: number | null;
    if (comp.prevCampaignMap) {
      const prevForPct = campaigns.filter((c) => {
        const prev = comp.prevCampaignMap!.get(c.campaign_id);
        return prev?.profit != null && prev?.spend != null;
      });
      const prevProfitSum = prevForPct.reduce((s, c) => s + comp.prevCampaignMap!.get(c.campaign_id)!.profit!, 0);
      const prevAllRevSum = prevForPct.reduce((s, c) => {
        const prev = comp.prevCampaignMap!.get(c.campaign_id)!;
        return s + prev.profit! + prev.spend!;
      }, 0);
      prevPctForDelta = prevAllRevSum > 0 ? (prevProfitSum / prevAllRevSum) * 100 : null;
    } else {
      prevPctForDelta = avgProfitPct;
    }
    const avgDeltaPct = prevPctForDelta !== null && avgSnapPct !== null ? prevPctForDelta - avgSnapPct : null;
    const profitPairs = campaigns.filter((c) => {
      const snapP = comp.campaignMap.get(c.campaign_id)?.profit;
      const prevP = comp.prevCampaignMap ? comp.prevCampaignMap.get(c.campaign_id)?.profit : c.profit;
      return snapP != null && prevP != null;
    });
    const totalDeltaProfit = profitPairs.length > 0
      ? profitPairs.reduce((s, c) => {
        const prevP = comp.prevCampaignMap ? (comp.prevCampaignMap.get(c.campaign_id)?.profit ?? 0) : (c.profit ?? 0);
        return s + prevP - comp.campaignMap.get(c.campaign_id)!.profit!;
      }, 0) : null;
    return { totalSnap, totalSnapRev, avgSnapRoas, avgSnapPct, totalSnapProfit, deltaSpend, deltaRev, avgDeltaRoas, avgDeltaPct, totalDeltaProfit };
  }

  /** Render 12 snapshot data + delta cells for one campaign row, for a single comparison */
  function renderCampaignSnapCols(c: MergedCampaign, comp: SnapshotComparison) {
    const snap = comp.campaignMap.get(c.campaign_id) ?? null;
    const fmtDelta = (v: number | null) => v !== null ? `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
    const getPrev = (field: keyof SnapshotRow): number | null => {
      if (!comp.prevCampaignMap) return (c as unknown as Record<string, number | null>)[field as string] as number | null;
      return (comp.prevCampaignMap.get(c.campaign_id)?.[field] ?? null) as number | null;
    };
    const deltaSpend = snap?.spend != null ? (getPrev('spend') ?? c.spend) - snap.spend : null;
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

  return (
    <div className="h-full flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex-1 min-h-0 overflow-x-scroll overflow-y-scroll" style={{ scrollbarGutter: 'stable' }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0, ...(zoom !== 100 ? { zoom: zoom / 100 } : {}) }}>
          <thead className="sticky top-0 z-10" style={{ boxShadow: '0 3px 10px rgba(0,0,0,0.12)' }}>
            {/* Group header row — borders on <th> cells (not <tr>) to fix Chrome sticky+border-collapse gap bug */}
            <tr>
              <th colSpan={2} className="bg-slate-100 border-r border-slate-300 border-b border-slate-300" />
              <th colSpan={fbColSpan} className="px-3 py-1.5 text-center text-xs font-semibold text-blue-700 bg-blue-50 border-r border-blue-200 border-b border-blue-200 tracking-wide uppercase">
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
            {/* Column header row — borders on <th> cells */}
            <tr className="bg-slate-100 text-slate-600 font-semibold">
              <th className="w-10 px-4 py-2.5 border-b border-slate-300">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-slate-300 bg-white h-5 w-5 cursor-pointer" />
              </th>
              <th className="px-3 py-2.5 text-left whitespace-nowrap border-r border-slate-300 border-b border-slate-300">Campaign</th>
              {showAccountColumn && <th className="px-3 py-2.5 text-left whitespace-nowrap bg-blue-100 border-b border-blue-200">Account</th>}
              <th className="px-3 py-2.5 text-left whitespace-nowrap bg-blue-100 border-b border-blue-200">Status</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-100 border-b border-blue-200 cursor-pointer" onClick={() => onSort('spend')}>Spend <SortBtn col="spend" sortCol={sortCol} sortDir={sortDir} onSort={onSort} /></th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-100 border-b border-blue-200 cursor-pointer" onClick={() => onSort('cpm')}>CPM <SortBtn col="cpm" sortCol={sortCol} sortDir={sortDir} onSort={onSort} /></th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-100 border-b border-blue-200">CTR (all)</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-100 border-r border-blue-200 border-b border-blue-200">Budget</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-emerald-100 cursor-pointer border-r border-emerald-200 border-b border-emerald-200" onClick={() => onSort('adjust_revenue')}>Revenue <SortBtn col="adjust_revenue" sortCol={sortCol} sortDir={sortDir} onSort={onSort} /></th>
              <th className="px-3 py-2.5 text-center whitespace-nowrap bg-purple-100 border-b border-purple-200">ID Match</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-purple-100 border-b border-purple-200 cursor-pointer" onClick={() => onSort('roas')}>D0 ROAS <SortBtn col="roas" sortCol={sortCol} sortDir={sortDir} onSort={onSort} /></th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-purple-100 border-b border-purple-200 cursor-pointer" onClick={() => onSort('profit_pct')}>%Profit <SortBtn col="profit_pct" sortCol={sortCol} sortDir={sortDir} onSort={onSort} /></th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-purple-100 border-b border-purple-200 cursor-pointer" onClick={() => onSort('profit')}>Profit <SortBtn col="profit" sortCol={sortCol} sortDir={sortDir} onSort={onSort} /></th>
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
            {/* Subtotal row — borders on <th> cells, stronger bottom border to separate from data */}
            <tr className="bg-slate-100 text-sm font-semibold text-slate-700">
              <th className="w-10 px-4 py-2 border-b-2 border-slate-400" />
              <th className="px-3 py-2 text-left text-slate-500 font-medium border-r border-slate-300 border-b-2 border-slate-400 whitespace-nowrap">
                {campaigns.length} campaigns · {matchedCount} matched
              </th>
              {showAccountColumn && <th className="px-3 py-2 bg-blue-100 border-b-2 border-blue-300" />}
              <th className="px-3 py-2 bg-blue-100 border-b-2 border-blue-300" />
              {/* Spend */}
              <th className="px-3 py-2 text-right tabular-nums bg-blue-100 border-b-2 border-blue-300">{fmtUsd(totalSpend)}</th>
              {/* CPM */}
              <th className="px-3 py-2 text-right text-slate-400 bg-blue-100 border-b-2 border-blue-300">—</th>
              {/* CTR */}
              <th className="px-3 py-2 text-right text-slate-400 bg-blue-100 border-b-2 border-blue-300">—</th>
              {/* Budget */}
              <th className="px-3 py-2 text-right text-slate-400 bg-blue-100 border-r border-blue-200 border-b-2 border-blue-300">—</th>
              {/* Revenue */}
              <th className="px-3 py-2 text-right tabular-nums bg-emerald-100 text-emerald-700 border-r border-emerald-200 border-b-2 border-emerald-300">
                {totalRevenue > 0 ? fmtUsd(totalRevenue) : <span className="text-slate-400">—</span>}
              </th>
              {/* ID Match */}
              <th className="px-3 py-2 text-center text-slate-400 bg-purple-100 border-b-2 border-purple-300">—</th>
              {/* Avg ROAS */}
              <th className={`px-3 py-2 text-right tabular-nums bg-purple-100 border-b-2 border-purple-300 ${avgRoas === null ? 'text-slate-400' : avgRoas >= 2 ? 'text-emerald-600' : avgRoas >= 1 ? 'text-amber-600' : 'text-red-600'}`}>
                {avgRoas !== null ? `${avgRoas.toFixed(2)}x` : '—'}
              </th>
              {/* Avg %Profit */}
              <th className={`px-3 py-2 text-right tabular-nums bg-purple-100 border-b-2 border-purple-300 ${avgProfitPct === null ? 'text-slate-400' : avgProfitPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {avgProfitPct !== null ? `${avgProfitPct >= 0 ? '+' : ''}${avgProfitPct.toFixed(1)}%` : '—'}
              </th>
              {/* Total Profit */}
              <th className={`px-3 py-2 text-right tabular-nums bg-purple-100 border-b-2 border-purple-300 ${totalProfit === 0 ? 'text-slate-400' : totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {totalRevenue > 0 ? fmtUsd(totalProfit) : <span className="text-slate-400">—</span>}
              </th>
              {snapshotComparisons.map((comp) => {
                const st = snapSubtotals(comp);
                const fmtDelta = (v: number) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
            {campaigns.map((c) => {
              const isExpanded = expandedIds.has(c.campaign_id);
              const budgetVal = c.budget_type === 'daily' ? c.daily_budget : c.budget_type === 'lifetime' ? c.lifetime_budget : null;

              return (
                <Fragment key={c.campaign_id}>
                  <tr className={`hover:bg-slate-50 transition-colors ${selectedIds.has(c.campaign_id) ? 'bg-indigo-50' : ''}`}>
                    <td className="px-4 py-2.5">
                      <input type="checkbox" checked={selectedIds.has(c.campaign_id)} onChange={() => toggleOne(c.campaign_id)} className="rounded border-slate-300 bg-white h-5 w-5 cursor-pointer" />
                    </td>
                    <td className="px-3 py-2.5 max-w-xs border-r border-slate-100">
                      <div className="flex items-start gap-2">
                        <button onClick={() => handleToggleExpand(c)} className="mt-0.5 flex-shrink-0 text-slate-400 hover:text-slate-700 text-xs w-4" title={isExpanded ? 'Collapse' : 'Expand ad sets'}>
                          {isExpanded ? '▼' : '▶'}
                        </button>
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 truncate" title={c.campaign_name}>{c.campaign_name}</div>
                          <div className="text-xs text-slate-400 font-mono">{c.campaign_id}</div>
                        </div>
                      </div>
                    </td>

                    {showAccountColumn && (
                      <td className="px-3 py-2.5 bg-blue-50/40">
                        <span className="text-xs text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">{c.account_name}</span>
                      </td>
                    )}
                    <td className="px-3 py-2.5 bg-blue-50/40">
                      {c.effective_status === 'ACTIVE'
                        ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">Active</span>
                        : <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Paused</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 bg-blue-50/40">{fmtUsd(c.spend)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 bg-blue-50/40">{fmtUsd(c.cpm)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 bg-blue-50/40">
                      {c.ctr > 0 ? `${c.ctr.toFixed(2)}%` : '—'}
                    </td>

                    {/* Budget */}
                    <td className="px-3 py-2.5 text-right bg-blue-50/40 border-r border-blue-100">
                      {c.budget_type === 'unknown' ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5 tabular-nums text-slate-700">
                          <span>{fmtUsd(budgetVal)}</span>
                          <span className="text-slate-400 text-xs">{c.budget_type === 'daily' ? '/d' : ' lt'}</span>
                          <button
                            onClick={() => setCampaignBudgetTarget({ id: c.campaign_id, name: c.campaign_name, budget_type: c.budget_type, daily_budget: c.daily_budget, lifetime_budget: c.lifetime_budget, entity_type: 'campaign', currency: c.currency, vndRate })}
                            className="text-indigo-500 hover:text-indigo-700 transition-colors text-xs"
                            title="Edit budget"
                          >✎</button>
                        </div>
                      )}
                    </td>

                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 bg-emerald-50/40 border-r border-emerald-100">
                      {c.has_adjust_data ? fmtUsd(c.adjust_revenue) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center bg-purple-50/40">
                      {c.has_adjust_data
                        ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">✓ Matched</span>
                        : <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">✗ No match</span>}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-semibold tabular-nums bg-purple-50/40 ${roasColorClass(c.roas)}`}>
                      {formatRoas(c.roas)}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums bg-purple-50/40 text-sm ${c.profit_pct === null ? 'text-slate-300' : c.profit_pct >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}`}>
                      {formatProfit(c.profit_pct)}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums bg-purple-50/40 text-sm font-medium ${c.profit === null ? 'text-slate-300' : c.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {c.profit !== null ? fmtUsd(c.profit) : '—'}
                    </td>
                    {snapshotComparisons.map((comp) => renderCampaignSnapCols(c, comp))}
                  </tr>

                  {isExpanded && (
                    <AdSetRows
                      adsets={mergeAdSets(adSetCache.get(c.campaign_id) ?? [], adjustAdSetMap, adjustAllRevAdSetMap, vndRate)}
                      loading={loadingAdSets.has(c.campaign_id)}
                      error={adSetErrors.get(c.campaign_id) ?? null}
                      showAccountColumn={showAccountColumn}
                      colCount={colCount}
                      onBudgetUpdate={() => refetchAdSets(c)}
                      vndRate={vndRate}
                      snapshotComparisons={snapshotComparisons}
                    />
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {campaignBudgetTarget && (
        <BudgetModal
          target={campaignBudgetTarget}
          onConfirm={handleCampaignBudgetConfirm}
          onClose={() => setCampaignBudgetTarget(null)}
        />
      )}
      {campaignBudgetError && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-200 text-xs text-red-600 flex items-center justify-between">
          <span>{campaignBudgetError}</span>
          <button onClick={() => setCampaignBudgetError('')} className="text-red-400 hover:text-red-700 ml-4">✕</button>
        </div>
      )}
      {budgetSuccessMsg && (
        <div className="px-4 py-2 bg-emerald-50 border-t border-emerald-200 text-xs text-emerald-700 flex items-center justify-between">
          <span>{budgetSuccessMsg}</span>
          <button onClick={() => setBudgetSuccessMsg('')} className="text-emerald-400 hover:text-emerald-700 ml-4">✕</button>
        </div>
      )}
    </div>
  );
}
