'use client';

import { Fragment, useState } from 'react';
import { mergeAdSets, roasColorClass, formatRoas, formatProfit } from '@/lib/adjust/merge';
import type { AdSetRow, BudgetTarget, MergedCampaign, SnapshotAdSetRow, SnapshotRow } from '@/lib/types';
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
    <button onClick={() => onSort(col)} className="hover:text-slate-100 select-none">
      {col === sortCol ? (sortDir === 'asc' ? ' ↑' : ' ↓') : <span className="text-slate-600"> ↕</span>}
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
  vndRate: number;
  /** Snapshot compare: map campaign_id → saved metrics. Null = no snapshot selected. */
  snapshotCampaignMap: Map<string, SnapshotRow> | null;
  /** Passed through to AdSetRows for adset-level compare columns. */
  snapshotAdSetMap: Map<string, SnapshotAdSetRow> | null;
  zoom?: number;
}

export default function CampaignTable({
  campaigns, selectedIds, onSelectionChange, sortCol, sortDir, onSort,
  showAccountColumn = false, adjustAdSetMap, vndRate,
  snapshotCampaignMap, snapshotAdSetMap, zoom = 100,
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
  const hasSnapshot = snapshotCampaignMap !== null;
  // Result group: ID Match + D0 ROAS + %Profit + Profit = 4 cols; snapshot: Old ROAS + Old Profit + Δ ROAS + Δ Profit = 4 cols
  const colCount = 2 + fbColSpan + 1 + 4 + (hasSnapshot ? 4 : 0);

  // Subtotals computed from visible campaigns
  const withRoas = campaigns.filter((c) => c.roas !== null);
  const withProfit = campaigns.filter((c) => c.profit_pct !== null);
  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
  const totalRevenue = campaigns.reduce((s, c) => s + (c.adjust_revenue ?? 0), 0);
  const totalProfit = campaigns.reduce((s, c) => s + (c.profit ?? 0), 0);
  const avgRoas = withRoas.length > 0 ? withRoas.reduce((s, c) => s + c.roas!, 0) / withRoas.length : null;
  const avgProfitPct = withProfit.length > 0 ? withProfit.reduce((s, c) => s + c.profit_pct!, 0) / withProfit.length : null;
  const matchedCount = campaigns.filter((c) => c.has_adjust_data).length;

  // Snapshot subtotals (only meaningful when snapshotCampaignMap is set)
  const snapWithRoas = snapshotCampaignMap
    ? campaigns.filter((c) => { const s = snapshotCampaignMap.get(c.campaign_id); return s?.roas !== null && s?.roas !== undefined; })
    : [];
  const snapWithProfit = snapshotCampaignMap
    ? campaigns.filter((c) => { const s = snapshotCampaignMap.get(c.campaign_id); return s?.profit !== null && s?.profit !== undefined; })
    : [];
  const avgSnapRoas = snapWithRoas.length > 0
    ? snapWithRoas.reduce((s, c) => s + snapshotCampaignMap!.get(c.campaign_id)!.roas!, 0) / snapWithRoas.length
    : null;
  const totalSnapProfit = snapWithProfit.length > 0
    ? snapWithProfit.reduce((s, c) => s + snapshotCampaignMap!.get(c.campaign_id)!.profit!, 0)
    : null;
  // Δ = current − snapshot, only where both sides have values
  const deltaRoasPairs = snapshotCampaignMap
    ? campaigns.filter((c) => { const s = snapshotCampaignMap.get(c.campaign_id); return c.roas !== null && s?.roas !== null && s?.roas !== undefined; })
    : [];
  const deltaProfitPairs = snapshotCampaignMap
    ? campaigns.filter((c) => { const s = snapshotCampaignMap.get(c.campaign_id); return c.profit !== null && s?.profit !== null && s?.profit !== undefined; })
    : [];
  const avgDeltaRoas = deltaRoasPairs.length > 0
    ? deltaRoasPairs.reduce((s, c) => s + (c.roas! - snapshotCampaignMap!.get(c.campaign_id)!.roas!), 0) / deltaRoasPairs.length
    : null;
  const totalDeltaProfit = deltaProfitPairs.length > 0
    ? deltaProfitPairs.reduce((s, c) => s + (c.profit! - snapshotCampaignMap!.get(c.campaign_id)!.profit!), 0)
    : null;

  return (
    <div className="h-full flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex-1 min-h-0 overflow-x-scroll overflow-y-scroll" style={{ scrollbarGutter: 'stable' }}>
        <table className="w-full text-sm border-collapse" style={zoom !== 100 ? { zoom: zoom / 100 } : undefined}>
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-slate-200">
              <th colSpan={2} className="bg-slate-50 border-r border-slate-200" />
              <th colSpan={fbColSpan} className="px-3 py-1.5 text-center text-xs font-semibold text-blue-700 bg-blue-50 border-r border-blue-100 tracking-wide uppercase">
                Facebook Ads Data
              </th>
              <th className="px-3 py-1.5 text-center text-xs font-semibold text-emerald-700 bg-emerald-50 border-r border-emerald-100 tracking-wide uppercase">
                Adjust CSV
              </th>
              <th colSpan={4} className="px-3 py-1.5 text-center text-xs font-semibold text-purple-700 bg-purple-50 tracking-wide uppercase">
                Result
              </th>
              {hasSnapshot && (
                <th colSpan={4} className="px-3 py-1.5 text-center text-xs font-semibold text-amber-700 bg-amber-50 border-l border-amber-100 tracking-wide uppercase">
                  Snapshot Compare
                </th>
              )}
            </tr>
            <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
              <th className="w-10 px-4 py-2.5">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-slate-300 bg-white h-5 w-5 cursor-pointer" />
              </th>
              <th className="px-3 py-2.5 text-left whitespace-nowrap border-r border-slate-200">Campaign</th>
              {showAccountColumn && <th className="px-3 py-2.5 text-left whitespace-nowrap bg-blue-50">Account</th>}
              <th className="px-3 py-2.5 text-left whitespace-nowrap bg-blue-50">Status</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50 cursor-pointer" onClick={() => onSort('spend')}>Spend <SortBtn col="spend" sortCol={sortCol} sortDir={sortDir} onSort={onSort} /></th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50 cursor-pointer" onClick={() => onSort('cpm')}>CPM <SortBtn col="cpm" sortCol={sortCol} sortDir={sortDir} onSort={onSort} /></th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50">CTR (all)</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50 border-r border-blue-100">Budget</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-emerald-50 cursor-pointer border-r border-emerald-100" onClick={() => onSort('adjust_revenue')}>Revenue <SortBtn col="adjust_revenue" sortCol={sortCol} sortDir={sortDir} onSort={onSort} /></th>
              <th className="px-3 py-2.5 text-center whitespace-nowrap bg-purple-50">ID Match</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-purple-50 cursor-pointer" onClick={() => onSort('roas')}>D0 ROAS <SortBtn col="roas" sortCol={sortCol} sortDir={sortDir} onSort={onSort} /></th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-purple-50 cursor-pointer" onClick={() => onSort('profit_pct')}>%Profit <SortBtn col="profit_pct" sortCol={sortCol} sortDir={sortDir} onSort={onSort} /></th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap bg-purple-50 cursor-pointer" onClick={() => onSort('profit')}>Profit <SortBtn col="profit" sortCol={sortCol} sortDir={sortDir} onSort={onSort} /></th>
              {hasSnapshot && (
                <>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap bg-amber-50 border-l border-amber-100 text-xs">Old ROAS</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap bg-amber-50 text-xs">Old Profit</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap bg-amber-50 text-xs">Δ ROAS</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap bg-amber-50 text-xs">Δ Profit</th>
                </>
              )}
            </tr>
            {/* Subtotal row — aligned to data columns */}
            <tr className="border-b-2 border-slate-300 bg-slate-50 text-xs font-semibold text-slate-600">
              <th className="w-10 px-4 py-1.5" />
              <th className="px-3 py-1.5 text-left text-slate-400 font-medium border-r border-slate-200 whitespace-nowrap">
                {campaigns.length} campaigns · {matchedCount} matched
              </th>
              {showAccountColumn && <th className="px-3 py-1.5 bg-blue-50/60" />}
              <th className="px-3 py-1.5 bg-blue-50/60" />
              {/* Spend */}
              <th className="px-3 py-1.5 text-right tabular-nums bg-blue-50/60 text-slate-700">{fmtUsd(totalSpend)}</th>
              {/* CPM */}
              <th className="px-3 py-1.5 text-right text-slate-300 bg-blue-50/60">—</th>
              {/* CTR */}
              <th className="px-3 py-1.5 text-right text-slate-300 bg-blue-50/60">—</th>
              {/* Budget */}
              <th className="px-3 py-1.5 text-right text-slate-300 bg-blue-50/60 border-r border-blue-100">—</th>
              {/* Revenue */}
              <th className="px-3 py-1.5 text-right tabular-nums bg-emerald-50/60 text-emerald-700 border-r border-emerald-100">
                {totalRevenue > 0 ? fmtUsd(totalRevenue) : <span className="text-slate-300">—</span>}
              </th>
              {/* ID Match */}
              <th className="px-3 py-1.5 text-center text-slate-400 bg-purple-50/60">—</th>
              {/* Avg ROAS */}
              <th className={`px-3 py-1.5 text-right tabular-nums bg-purple-50/60 ${avgRoas === null ? 'text-slate-300' : avgRoas >= 2 ? 'text-emerald-600' : avgRoas >= 1 ? 'text-amber-600' : 'text-red-600'}`}>
                {avgRoas !== null ? `${avgRoas.toFixed(2)}x` : '—'}
              </th>
              {/* Avg %Profit */}
              <th className={`px-3 py-1.5 text-right tabular-nums bg-purple-50/60 ${avgProfitPct === null ? 'text-slate-300' : avgProfitPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {avgProfitPct !== null ? `${avgProfitPct >= 0 ? '+' : ''}${avgProfitPct.toFixed(1)}%` : '—'}
              </th>
              {/* Total Profit */}
              <th className={`px-3 py-1.5 text-right tabular-nums bg-purple-50/60 ${totalProfit === 0 ? 'text-slate-300' : totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {totalRevenue > 0 ? fmtUsd(totalProfit) : <span className="text-slate-300">—</span>}
              </th>
              {hasSnapshot && (
                <>
                  {/* Avg Old ROAS */}
                  <th className={`px-3 py-1.5 text-right tabular-nums bg-amber-50/60 border-l border-amber-100 text-xs font-semibold ${avgSnapRoas === null ? 'text-slate-300' : avgSnapRoas >= 2 ? 'text-emerald-600' : avgSnapRoas >= 1 ? 'text-amber-600' : 'text-red-600'}`}>
                    {avgSnapRoas !== null ? `${avgSnapRoas.toFixed(2)}x` : '—'}
                  </th>
                  {/* Total Old Profit */}
                  <th className={`px-3 py-1.5 text-right tabular-nums bg-amber-50/60 text-xs font-semibold ${totalSnapProfit === null ? 'text-slate-300' : totalSnapProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {totalSnapProfit !== null ? fmtUsd(totalSnapProfit) : '—'}
                  </th>
                  {/* Avg Δ ROAS */}
                  <th className={`px-3 py-1.5 text-right tabular-nums bg-amber-50/60 text-xs font-semibold ${avgDeltaRoas === null ? 'text-slate-300' : avgDeltaRoas >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {avgDeltaRoas !== null ? `${avgDeltaRoas >= 0 ? '+' : ''}${avgDeltaRoas.toFixed(2)}x` : '—'}
                  </th>
                  {/* Total Δ Profit */}
                  <th className={`px-3 py-1.5 text-right tabular-nums bg-amber-50/60 text-xs font-semibold ${totalDeltaProfit === null ? 'text-slate-300' : totalDeltaProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {totalDeltaProfit !== null ? `${totalDeltaProfit >= 0 ? '+' : '-'}$${Math.abs(totalDeltaProfit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                  </th>
                </>
              )}
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
                    {/* Snapshot compare columns: Old ROAS | Old Profit | Δ ROAS | Δ Profit */}
                    {hasSnapshot && (() => {
                      const snap = snapshotCampaignMap?.get(c.campaign_id) ?? null;
                      const deltaRoas = snap && c.roas !== null && snap.roas !== null ? c.roas - snap.roas : null;
                      const deltaProfit = snap && c.profit !== null && snap.profit !== null ? c.profit - snap.profit : null;
                      return (
                        <>
                          <td className={`px-3 py-2.5 text-right tabular-nums bg-amber-50/40 border-l border-amber-100 text-xs font-semibold ${roasColorClass(snap?.roas ?? null)}`}>
                            {snap ? formatRoas(snap.roas) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className={`px-3 py-2.5 text-right tabular-nums bg-amber-50/40 text-xs font-medium ${snap === null || snap.profit === null ? 'text-slate-300' : snap.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {snap?.profit !== null && snap?.profit !== undefined ? fmtUsd(snap.profit) : '—'}
                          </td>
                          <td className={`px-3 py-2.5 text-right tabular-nums bg-amber-50/40 text-xs font-semibold ${deltaRoas === null ? 'text-slate-300' : deltaRoas >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {deltaRoas !== null ? `${deltaRoas >= 0 ? '+' : ''}${deltaRoas.toFixed(2)}x` : '—'}
                          </td>
                          <td className={`px-3 py-2.5 text-right tabular-nums bg-amber-50/40 text-xs font-semibold ${deltaProfit === null ? 'text-slate-300' : deltaProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {deltaProfit !== null ? `${deltaProfit >= 0 ? '+' : '-'}$${Math.abs(deltaProfit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                          </td>
                        </>
                      );
                    })()}
                  </tr>

                  {isExpanded && (
                    <AdSetRows
                      adsets={mergeAdSets(adSetCache.get(c.campaign_id) ?? [], adjustAdSetMap, vndRate)}
                      loading={loadingAdSets.has(c.campaign_id)}
                      error={adSetErrors.get(c.campaign_id) ?? null}
                      showAccountColumn={showAccountColumn}
                      colCount={colCount}
                      onBudgetUpdate={() => refetchAdSets(c)}
                      vndRate={vndRate}
                      snapshotAdSetMap={snapshotAdSetMap}
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
