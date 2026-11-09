'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Flame, ChevronLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { mergeCampaigns, mergeAdSets, type CampaignRevenueMaps } from '@/lib/adjust/merge';
import { getInitials } from '@/lib/utils';
import type { AppsflyerParseResult } from '@/lib/appsflyer/appsflyer-csv-parser';
import type { AdSetRow, CampaignRow, FbAdAccount, MergedCampaign, SnapshotAdSetRow, SnapshotComparison, SnapshotData, SnapshotMeta, SnapshotRow, StaffMember, UserRole } from '@/lib/types';
import AppsflyerCsvUpload from './appsflyer-csv-upload';
import AppsflyerRevenueStatus from './appsflyer-revenue-status';
import { useAppsflyerRevenue } from './use-appsflyer-revenue';
import CampaignTable from './campaign-table';
import FilterBar from './filter-bar';
import ActionBar from './action-bar';
import AdsetFlatView, { type FlatAdSet } from './adset-flat-view';
import AdsetBulkBudgetModal from './adset-bulk-budget-modal';
import SnapshotToolbar from './snapshot-toolbar';
import ExportSpendModal from './export-spend-modal';

type Phase = 'idle' | 'csv_ready' | 'analyzing' | 'results' | 'error';

type FlatRawAdSet = AdSetRow & { campaign_name: string };

/** Campaigns whose ad sets load in parallel in the ad-set-only view. */
const ADSET_LOAD_CONCURRENCY = 6;

interface Props {
  hasToken: boolean;
  selectedAccounts: FbAdAccount[];
  userRole: UserRole;
  staffList: StaffMember[];
  userEmail: string;
}

export default function CampaignHub({ hasToken, selectedAccounts, userRole, staffList, userEmail }: Props) {
  const router = useRouter();

  // Leader/admin: which staff member to view (null = own data)
  const [viewingStaffId, setViewingStaffId] = useState<string | null>(null);
  const viewingStaff = staffList.find((s) => s.id === viewingStaffId) ?? null;

  const [phase, setPhase] = useState<Phase>('idle');
  const [rawFbCampaigns, setRawFbCampaigns] = useState<CampaignRow[]>([]);
  // AppsFlyer CSV → per-campaign / per-adset revenue maps (names kept from the Adjust era)
  const appsflyer = useAppsflyerRevenue(rawFbCampaigns);
  const {
    campaignRev: adjustMapState, campaignAllRev: adjustAllRevMapState,
    adsetRev: adjustAdSetMapState, adsetAllRev: adjustAllRevAdSetMapState, appByCampaign: adjustAppMapState,
  } = appsflyer.maps;
  // Bumped per Analyze and by Start Over / staff switch — a late Analyze never renders under the wrong user.
  const analyzeSeq = useRef(0);
  // Adset-only flat view
  const [showAdsetOnly, setShowAdsetOnly] = useState(false);
  const [rawFlatAdSets, setRawFlatAdSets] = useState<FlatRawAdSet[]>([]);
  const [loadingAllAdsets, setLoadingAllAdsets] = useState(false);
  const [flatAdsetsError, setFlatAdsetsError] = useState('');
  // Bumped per ad-set-only load so a slow older load never overwrites a newer one.
  const loadAdsetsSeq = useRef(0);
  const [selectedFlatAdsetIds, setSelectedFlatAdsetIds] = useState<Set<string>>(new Set());
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [roasMin, setRoasMin] = useState('');
  const [roasMax, setRoasMax] = useState('');
  const [accountFilter, setAccountFilter] = useState(''); // '' = all accounts
  const [appNameFilter, setAppNameFilter] = useState<string[]>([]);
  const [campaignNameFilter, setCampaignNameFilter] = useState('');
  const [campaignNameKeywords, setCampaignNameKeywords] = useState<string[]>([]);
  const [spendMin, setSpendMin] = useState('');
  const [spendMax, setSpendMax] = useState('');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [sortCol, setSortCol] = useState<string>('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [vndRate, setVndRate] = useState(26000);
  const [rateInput, setRateInput] = useState('26000');
  // Derived, so the latest campaigns and the latest revenue always combine, whichever finished last.
  const mergedCampaigns = useMemo(
    () => mergeCampaigns(rawFbCampaigns, adjustMapState, adjustAllRevMapState, vndRate),
    [rawFbCampaigns, adjustMapState, adjustAllRevMapState, vndRate],
  );
  // Campaign revenue for ad sets that are their campaign's only one (campaign-level AppsFlyer file).
  const campaignRev = useMemo<CampaignRevenueMaps>(
    () => ({ cohort: adjustMapState, allRev: adjustAllRevMapState }),
    [adjustMapState, adjustAllRevMapState],
  );
  // Snapshots — multi-compare support
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  /** Ordered list of snapshot IDs added to comparison (index 0 = first added) */
  const [comparedSnapshotIds, setComparedSnapshotIds] = useState<string[]>([]);
  /** Cached snapshot data by ID — avoids re-fetching when toggling comparisons */
  const [snapshotsCache, setSnapshotsCache] = useState<Map<string, SnapshotData>>(new Map());
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [snapshotError, setSnapshotError] = useState('');
  // Status filter: 'all' shows active + paused-with-spend; 'active'/'inactive' are explicit
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Auto-select zoom based on available viewport height so small monitors show as many rows as large ones
  const [zoom, setZoom] = useState<number>(() => {
    if (typeof window === 'undefined') return 100;
    const h = window.innerHeight;
    if (h >= 900) return 100;
    if (h >= 768) return 90;
    return 80;
  });

  // Determine if the current view has FB credentials configured
  const viewingAccounts = viewingStaff ? viewingStaff.accounts : selectedAccounts;
  const hasFbConfig = hasToken && viewingAccounts.length > 0;

  // Whether any loaded campaign is in VND
  const hasVndAccounts = useMemo(
    () => rawFbCampaigns.some((c) => c.currency === 'VND'),
    [rawFbCampaigns],
  );

  function handleStartOver() {
    analyzeSeq.current++;
    setPhase('idle');
    setRawFbCampaigns([]);
    appsflyer.reset();
    setShowAdsetOnly(false);
    loadAdsetsSeq.current++;
    setLoadingAllAdsets(false);
    setFlatAdsetsError('');
    setRawFlatAdSets([]);
    setSelectedFlatAdsetIds(new Set());
    setSelectedIds(new Set());
    setAccountFilter('');
    setAppNameFilter([]);
    setCampaignNameFilter('');
    setCampaignNameKeywords([]);
    setSpendMin(''); setSpendMax('');
    setBudgetMin(''); setBudgetMax('');
    setRoasMin(''); setRoasMax('');
    setSnapshots([]);
    setComparedSnapshotIds([]);
    setSnapshotsCache(new Map());
    setStatusFilter('all');
  }

  /** Locks the current search text into a keyword chip and clears the box for the next keyword. */
  function handleAddCampaignKeyword(raw: string) {
    const kw = raw.trim();
    if (!kw) {
      setCampaignNameFilter('');
      return;
    }
    setCampaignNameKeywords((prev) =>
      prev.some((k) => k.toLowerCase() === kw.toLowerCase()) ? prev : [...prev, kw]
    );
    setCampaignNameFilter('');
  }

  function handleRemoveCampaignKeyword(kw: string) {
    setCampaignNameKeywords((prev) => prev.filter((k) => k !== kw));
  }

  async function fetchSnapshots() {
    const res = await fetch('/api/snapshots');
    if (res.ok) {
      const data = await res.json();
      setSnapshots(data.snapshots ?? []);
    }
  }

  async function handleAddSnapshot(id: string) {
    // Fetch and cache if not already loaded
    if (!snapshotsCache.has(id)) {
      const res = await fetch(`/api/snapshots/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSnapshotsCache((prev) => new Map([...prev, [id, data.snapshot_data as SnapshotData]]));
      }
    }
    // Unshift so new additions appear leftmost (older snapshots pushed right toward Current)
    setComparedSnapshotIds((prev) => prev.includes(id) ? prev : [id, ...prev]);
  }

  function handleRemoveSnapshot(id: string) {
    setComparedSnapshotIds((prev) => prev.filter((sid) => sid !== id));
  }

  async function handleSaveSnapshot(name: string) {
    setSavingSnapshot(true);
    setSnapshotError('');
    try {
      // Collect current campaign metrics
      const campaigns: SnapshotRow[] = mergedCampaigns.map((c) => ({
        campaign_id: c.campaign_id,
        campaign_name: c.campaign_name,
        spend: c.spend,
        cpi: c.cpi,
        adjust_revenue: c.adjust_revenue,
        roas: c.roas,
        profit_pct: c.profit_pct,
        profit: c.profit,
      }));
      // If flat adsets are already loaded (user is in Show Adset Only view), use them directly.
      // This avoids 3000+ parallel API calls which commonly fail under rate limits.
      let adsets: SnapshotAdSetRow[];
      if (flatAdsets.length > 0) {
        adsets = flatAdsets.map((a): SnapshotAdSetRow => ({
          adset_id: a.adset_id,
          campaign_id: a.campaign_id,
          adset_name: a.adset_name,
          spend: a.spend,
          cpi: a.cpi,
          adjust_revenue: a.adjust_revenue,
          roas: a.roas,
          profit_pct: a.profit_pct,
          profit: a.profit,
        }));
      } else {
        // Campaign view: fetch adsets per campaign in parallel (errors per-campaign silenced → [])
        const adsetResults = await Promise.all(
          mergedCampaigns.map(async (c) => {
            try {
              const url = `/api/campaigns/${c.campaign_id}/adsets?accountId=${encodeURIComponent(c.account_id)}&accountName=${encodeURIComponent(c.account_name)}&currency=${encodeURIComponent(c.currency)}`;
              const res = await fetch(url);
              const data = await res.json();
              if (!res.ok) return [] as SnapshotAdSetRow[];
              return mergeAdSets(data.adsets as AdSetRow[], adjustAdSetMapState, adjustAllRevAdSetMapState, vndRate, campaignRev).map((a): SnapshotAdSetRow => ({
                adset_id: a.adset_id,
                campaign_id: c.campaign_id,
                adset_name: a.adset_name,
                spend: a.spend,
                cpi: a.cpi,
                adjust_revenue: a.adjust_revenue,
                roas: a.roas,
                profit_pct: a.profit_pct,
                profit: a.profit,
              }));
            } catch {
              return [] as SnapshotAdSetRow[];
            }
          }),
        );
        adsets = adsetResults.flat();
      }
      const snapshot_data: SnapshotData = { campaigns, adsets };
      const postRes = await fetch('/api/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, snapshot_data }),
      });
      if (!postRes.ok) {
        const errData = await postRes.json().catch(() => ({}));
        throw new Error((errData as { error?: string }).error ?? `Save failed (${postRes.status})`);
      }
      await fetchSnapshots();
    } catch (err) {
      setSnapshotError(err instanceof Error ? err.message : 'Failed to save snapshot');
    } finally {
      setSavingSnapshot(false);
    }
  }

  async function handleDeleteSnapshot(id: string) {
    await fetch(`/api/snapshots/${id}`, { method: 'DELETE' });
    // Remove from comparison and cache
    setComparedSnapshotIds((prev) => prev.filter((sid) => sid !== id));
    setSnapshotsCache((prev) => { const m = new Map(prev); m.delete(id); return m; });
    await fetchSnapshots();
  }

  function handleRecalculate() {
    const rate = parseFloat(rateInput);
    if (isNaN(rate) || rate <= 0) return;
    setVndRate(rate);
  }

  async function fetchCampaignAdsets(c: MergedCampaign): Promise<FlatRawAdSet[]> {
    const url = `/api/campaigns/${c.campaign_id}/adsets?accountId=${encodeURIComponent(c.account_id)}&accountName=${encodeURIComponent(c.account_name)}&currency=${encodeURIComponent(c.currency)}`;
    const res = await fetch(url);
    // Platform timeouts return non-JSON bodies — fall back to the HTTP status.
    const data = await res.json().catch(() => ({})) as { adsets?: AdSetRow[]; error?: string };
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return (data.adsets ?? []).map((a) => ({ ...a, campaign_name: c.campaign_name }));
  }

  async function loadAllAdsets(campaigns: MergedCampaign[]) {
    const mySeq = ++loadAdsetsSeq.current;
    setLoadingAllAdsets(true);
    setRawFlatAdSets([]);
    setSelectedFlatAdsetIds(new Set());
    setFlatAdsetsError('');
    const rows: FlatRawAdSet[] = [];
    const failed: string[] = [];
    // Bounded so a long campaign list does not fire every Graph call at once and trip FB rate limits.
    for (let i = 0; i < campaigns.length; i += ADSET_LOAD_CONCURRENCY) {
      await Promise.all(campaigns.slice(i, i + ADSET_LOAD_CONCURRENCY).map(async (c) => {
        try {
          rows.push(...await fetchCampaignAdsets(c));
        } catch (err) {
          failed.push(`${c.campaign_name}: ${err instanceof Error ? err.message : 'failed'}`);
        }
      }));
      if (mySeq !== loadAdsetsSeq.current) return; // filters changed meanwhile — a newer load owns the table
    }
    setRawFlatAdSets(rows);
    if (failed.length > 0) {
      setFlatAdsetsError(`Ad sets of ${failed.length} campaign${failed.length !== 1 ? 's' : ''} could not be loaded — ${failed.slice(0, 3).join('; ')}${failed.length > 3 ? '; …' : ''}`);
    }
    setLoadingAllAdsets(false);
  }

  /** After a budget edit in the ad-set-only view: reload just that campaign's ad sets, keeping the table in place. */
  async function refreshFlatAdsetsOf(campaignId: string) {
    const c = mergedCampaigns.find((m) => m.campaign_id === campaignId);
    if (!c) return;
    const seq = loadAdsetsSeq.current;
    try {
      const fresh = await fetchCampaignAdsets(c);
      if (seq !== loadAdsetsSeq.current) return;
      setRawFlatAdSets((prev) => [...prev.filter((a) => a.campaign_id !== campaignId), ...fresh]);
    } catch (err) {
      if (seq !== loadAdsetsSeq.current) return;
      setFlatAdsetsError(`Budget saved, but reloading ${c.campaign_name} failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  function switchToStaff(staffId: string | null) {
    setViewingStaffId(staffId);
    handleStartOver();
  }

  /** Step 1 drop zone: a parsed file enables Analyze; a failed/cleared file disables it. */
  function handleCsvReady(result: AppsflyerParseResult | null) {
    appsflyer.setParsed(result);
    setPhase(result ? 'csv_ready' : 'idle');
  }

  /** File replaced from the results view: re-map ads; the merged campaigns follow the new maps. */
  function handleAppsflyerReplace(result: AppsflyerParseResult) {
    void appsflyer.applyRevenue(viewingStaffId, result); // errors surface in AppsflyerRevenueStatus
  }

  async function fetchFbCampaigns(): Promise<CampaignRow[]> {
    const url = new URL('/api/campaigns', window.location.origin);
    if (viewingStaffId) url.searchParams.set('viewAs', viewingStaffId);
    const res = await fetch(url.toString());
    const data = await res.json().catch(() => ({})) as { campaigns?: CampaignRow[]; error?: string };
    if (!res.ok || data.error) throw new Error(data.error ?? `Failed to fetch campaigns (${res.status})`);
    return data.campaigns ?? [];
  }

  async function handleAnalyze() {
    if (!appsflyer.parsed) return;
    const seq = ++analyzeSeq.current;
    setPhase('analyzing');
    setErrorMsg('');
    setSelectedIds(new Set());
    setAccountFilter('');

    // FB campaigns + AppsFlyer ad → campaign mapping in parallel. A failed mapping only drops the
    // revenue (shown by AppsflyerRevenueStatus); the campaigns still load.
    const [fbResult] = await Promise.allSettled([fetchFbCampaigns(), appsflyer.applyRevenue(viewingStaffId)]);
    if (seq !== analyzeSeq.current) return; // superseded by Start Over, a staff switch or a newer Analyze
    if (fbResult.status === 'rejected') {
      setErrorMsg(fbResult.reason instanceof Error ? fbResult.reason.message : 'Unknown error');
      setPhase('error');
      return;
    }
    setRawFbCampaigns(fbResult.value);
    setPhase('results');
    fetchSnapshots(); // load saved snapshots when results are ready
  }

  function handleSort(col: string) {
    if (col === sortCol) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('desc'); }
  }

  // Unique account names found in loaded campaigns (for filter dropdown)
  const accountOptions = useMemo(() => {
    const seen = new Map<string, string>(); // account_id → account_name
    for (const c of mergedCampaigns) seen.set(c.account_id, c.account_name);
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [mergedCampaigns]);

  // Unique app names from the AppsFlyer CSV (more reliable than FB app_name which is null for non-app campaigns)
  const appOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const appName of adjustAppMapState.values()) {
      if (appName) seen.add(appName);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [adjustAppMapState]);

  // Flat adset view: re-merge raw adsets whenever vndRate or adjustAdSetMap changes
  const flatAdsets: FlatAdSet[] = useMemo(() => {
    if (rawFlatAdSets.length === 0) return [];
    return rawFlatAdSets.map((raw) => {
      const merged = mergeAdSets([raw], adjustAdSetMapState, adjustAllRevAdSetMapState, vndRate, campaignRev)[0]!;
      return { ...merged, campaign_name: raw.campaign_name };
    });
  }, [rawFlatAdSets, adjustAdSetMapState, adjustAllRevAdSetMapState, vndRate, campaignRev]);

  const selectedFlatAdsets = useMemo(
    () => flatAdsets.filter((a) => selectedFlatAdsetIds.has(a.adset_id)),
    [flatAdsets, selectedFlatAdsetIds],
  );

  /**
   * Campaigns matching all non-status filters.
   * Used as the source for adset loading so that status filter applies at adset level,
   * allowing inactive adsets within active campaigns (and vice versa) to appear correctly.
   */
  const filteredCampaignsBase = useMemo(() => {
    let list = [...mergedCampaigns];
    const nameKeywords = [...campaignNameKeywords, campaignNameFilter]
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    if (nameKeywords.length > 0) {
      list = list.filter((c) => {
        const name = c.campaign_name.toLowerCase();
        return nameKeywords.every((k) => name.includes(k));
      });
    }
    if (accountFilter) list = list.filter((c) => c.account_id === accountFilter);
    if (appNameFilter.length > 0) list = list.filter((c) => {
      const app = adjustAppMapState.get(c.campaign_id);
      return app !== undefined && appNameFilter.includes(app);
    });
    const roasMinN = roasMin !== '' ? parseFloat(roasMin) : null;
    const roasMaxN = roasMax !== '' ? parseFloat(roasMax) : null;
    if (roasMinN !== null) list = list.filter((c) => c.roas !== null && c.roas >= roasMinN);
    if (roasMaxN !== null) list = list.filter((c) => c.roas !== null && c.roas <= roasMaxN);
    const spendMinN = spendMin !== '' ? parseFloat(spendMin) : null;
    const spendMaxN = spendMax !== '' ? parseFloat(spendMax) : null;
    if (spendMinN !== null) list = list.filter((c) => c.spend >= spendMinN);
    if (spendMaxN !== null) list = list.filter((c) => c.spend <= spendMaxN);
    const budgetMinN = budgetMin !== '' ? parseFloat(budgetMin) : null;
    const budgetMaxN = budgetMax !== '' ? parseFloat(budgetMax) : null;
    if (budgetMinN !== null) list = list.filter((c) => {
      const b = c.daily_budget ?? c.lifetime_budget ?? 0;
      return b >= budgetMinN;
    });
    if (budgetMaxN !== null) list = list.filter((c) => {
      const b = c.daily_budget ?? c.lifetime_budget ?? 0;
      return b <= budgetMaxN;
    });
    return list;
  }, [mergedCampaigns, adjustAppMapState, campaignNameFilter, campaignNameKeywords, accountFilter, appNameFilter, roasMin, roasMax, spendMin, spendMax, budgetMin, budgetMax]);

  /**
   * Campaigns filtered by campaign status. Used by both campaign view and adset loading.
   * Status filter is campaign-level in both views — adsets shown = adsets belonging to these campaigns.
   */
  const campaignsForStatus = useMemo(() => {
    let list = [...filteredCampaignsBase];
    if (statusFilter === 'active') list = list.filter((c) => c.effective_status === 'ACTIVE');
    else if (statusFilter === 'inactive') list = list.filter((c) => c.effective_status !== 'ACTIVE');
    else list = list.filter((c) => c.effective_status === 'ACTIVE' || c.spend > 0);
    return list;
  }, [filteredCampaignsBase, statusFilter]);

  // displayedCampaigns and selectedCampaigns are defined after snapshotComparisons below


  /**
   * Ordered array of snapshot comparisons for the table components.
   * Layout: [oldest snapshot … newest snapshot | Current live]
   * Index i < n-1: delta = snapshot[i+1] − snapshot[i]  (right neighbor is newer)
   * Index n-1 (rightmost): delta = current live data − snapshot
   */
  const snapshotComparisons = useMemo<SnapshotComparison[]>(() => {
    return comparedSnapshotIds.flatMap((id, i) => {
      const data = snapshotsCache.get(id);
      const meta = snapshots.find((s) => s.id === id);
      if (!data || !meta) return [];
      const prevId = i < comparedSnapshotIds.length - 1 ? comparedSnapshotIds[i + 1] : null;
      const prevData = prevId ? snapshotsCache.get(prevId) : null;
      return [{
        id,
        name: meta.name,
        campaignMap: new Map(data.campaigns.map((r) => [r.campaign_id, r])),
        adsetMap: new Map(data.adsets.map((r) => [r.adset_id, r])),
        prevCampaignMap: prevData ? new Map(prevData.campaigns.map((r) => [r.campaign_id, r])) : null,
        prevAdsetMap: prevData ? new Map(prevData.adsets.map((r) => [r.adset_id, r])) : null,
      } satisfies SnapshotComparison];
    });
  }, [comparedSnapshotIds, snapshotsCache, snapshots]);

  /** Campaign view: campaignsForStatus + sort. Defined after snapshotComparisons so snap/delta keys work. */
  const displayedCampaigns = useMemo(() => {
    return [...campaignsForStatus].sort((a, b) => {
      let av: number, bv: number;
      if (sortCol.startsWith('snap:') || sortCol.startsWith('delta:')) {
        const [type, compId, field] = sortCol.split(':');
        const comp = snapshotComparisons.find((c) => c.id === compId);
        const getVal = (c: MergedCampaign): number => {
          const snap = comp?.campaignMap.get(c.campaign_id);
          const snapVal = (snap?.[field as keyof typeof snap] as number | null) ?? null;
          if (snapVal == null) return 0;
          if (type === 'snap') return snapVal;
          const prevVal = comp?.prevCampaignMap
            ? ((comp.prevCampaignMap.get(c.campaign_id)?.[field as keyof SnapshotRow] as number | null) ?? null)
            : ((c[field as keyof MergedCampaign] as number | null) ?? null);
          return prevVal != null ? prevVal - snapVal : 0;
        };
        av = getVal(a); bv = getVal(b);
      } else {
        av = ((a[sortCol as keyof MergedCampaign] as number | null) ?? 0);
        bv = ((b[sortCol as keyof MergedCampaign] as number | null) ?? 0);
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [campaignsForStatus, sortCol, sortDir, snapshotComparisons]);

  const selectedCampaigns = useMemo(
    () => displayedCampaigns.filter((c) => selectedIds.has(c.campaign_id)),
    [displayedCampaigns, selectedIds],
  );

  /**
   * Adsets to display in the adset-only view.
   * Status filter is applied at campaign level (via campaignsForStatus → loadAllAdsets),
   * so all loaded adsets belong to the status-filtered campaigns — no additional adset-level filter needed.
   */
  const displayedFlatAdsets = flatAdsets;

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const isResults = phase === 'results';

  // Reload adsets when status-filtered campaigns change or adset view is toggled.
  // campaignsForStatus = filteredCampaignsBase + campaign status filter (no sort),
  // so sort changes don't trigger unnecessary re-fetches.
  useEffect(() => {
    // An empty campaign list still loads (to nothing) so ad sets of filtered-out campaigns do not linger.
    if (showAdsetOnly) loadAllAdsets(campaignsForStatus);
  }, [campaignsForStatus, showAdsetOnly]);

  return (
    <div className="flex flex-col bg-slate-50 min-h-screen">
      <header className="flex-shrink-0 bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/tools" className="text-xs font-medium text-slate-600 hover:text-indigo-600 transition-colors flex items-center gap-1 mr-1">
            <ChevronLeft className="w-3.5 h-3.5" /> Tools
          </Link>
          <h1 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5"><Flame className="w-4 h-4 text-orange-500" /> It&apos;s Cooking Time</h1>
          {/* Leader/admin: staff switcher */}
          {(userRole === 'leader' || userRole === 'admin') && staffList.length > 0 && (
            <select
              value={viewingStaffId ?? ''}
              onChange={(e) => switchToStaff(e.target.value || null)}
              className="text-xs border border-slate-300 rounded-lg px-2 py-1 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">My dashboard</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>{s.email}</option>
              ))}
            </select>
          )}
          {viewingStaff && (
            <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">
              Viewing: {viewingStaff.email}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {/* Zoom control */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-400">Zoom</span>
            <select
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="text-xs border border-slate-300 rounded px-1.5 py-0.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value={100}>100%</option>
              <option value={90}>90%</option>
              <option value={80}>80%</option>
              <option value={75}>75%</option>
              <option value={70}>70%</option>
            </select>
          </div>
          {userRole === 'admin' && (
            <Link href="/admin" className="text-sm text-purple-600 hover:text-purple-700 font-medium">Admin</Link>
          )}
          {/* User identity */}
          <div className="flex items-center gap-1.5">
            <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-semibold flex items-center justify-center select-none">
              {getInitials(userEmail)}
            </span>
            <span className="text-xs text-slate-400 hidden sm:block max-w-[120px] truncate">{userEmail}</span>
          </div>
          <Link href="/settings" className="text-sm text-slate-500 hover:text-slate-800">Settings</Link>
          <span className="text-slate-200 select-none">|</span>
          <button onClick={handleSignOut} className="text-sm text-red-500 hover:text-red-700 font-medium transition-colors">Sign out</button>
        </div>
      </header>

      <main className={isResults ? 'px-6 pt-4 pb-4 w-full flex flex-col gap-3' : 'max-w-screen-xl mx-auto w-full px-6 py-6 flex flex-col gap-5'}>

        {!hasToken && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            Facebook access token not configured.{' '}
            <Link href="/settings" className="font-medium underline">Go to Settings</Link> to add it.
          </div>
        )}

        {hasToken && viewingAccounts.length === 0 && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            No ad accounts selected.{' '}
            <Link href="/settings" className="font-medium underline">Go to Settings</Link>{' '}
            to fetch and select your ad accounts.
          </div>
        )}

        {/* Step card */}
        {phase !== 'results' && (
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5 max-w-lg">

            {/* Account summary (informational, not a selector) */}
            {hasFbConfig && (
              <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-700">
                Will fetch active campaigns from <strong>{viewingAccounts.length}</strong> ad account{viewingAccounts.length !== 1 ? 's' : ''}:&nbsp;
                {viewingAccounts.map((a) => a.name).join(', ')}
              </div>
            )}

            {/* Step 1: AppsFlyer revenue */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-semibold">1</span>
                <h2 className="font-medium text-slate-900">Upload AppsFlyer CSV</h2>
              </div>
              <p className="text-xs text-slate-500">Export today&apos;s App performance by Ad ID report from AppsFlyer</p>
              <AppsflyerCsvUpload key={appsflyer.uploadKey} onReady={handleCsvReady} disabled={!hasFbConfig} />
            </div>

            {phase === 'csv_ready' && (
              <>
                <hr className="border-slate-200" />
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-semibold">2</span>
                    <h2 className="font-medium text-slate-900">Fetch &amp; Analyze</h2>
                  </div>
                  <button
                    onClick={handleAnalyze}
                    className="w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                  >
                    Fetch all active campaigns &amp; match with CSV
                  </button>
                </div>
              </>
            )}

            {phase === 'analyzing' && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <svg className="animate-spin w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Fetching active campaigns from {viewingAccounts.length} account{viewingAccounts.length !== 1 ? 's' : ''}…
              </div>
            )}

            {phase === 'error' && (
              <div className="space-y-2">
                <p className="text-sm text-red-600">{errorMsg}</p>
                <button onClick={() => setPhase('csv_ready')} className="text-xs text-indigo-600 hover:underline">Try again</button>
              </div>
            )}
          </div>
        )}

        {/* Results */}
        {phase === 'results' && (
          <div className="flex flex-col gap-3">
            {/* Controls */}
            <div className="flex flex-col gap-3">
              {/* VND/USD rate control — always shown; Start Over is right-aligned here */}
              <div className="flex items-center gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm">
                {hasVndAccounts && (
                  <>
                    <span className="text-orange-800 font-medium whitespace-nowrap">VND → USD rate:</span>
                    <input
                      type="number"
                      value={rateInput}
                      onChange={(e) => setRateInput(e.target.value)}
                      min="1"
                      className="w-28 px-2 py-1 border border-slate-300 rounded text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
                      placeholder="26000"
                    />
                    <button
                      onClick={handleRecalculate}
                      className="px-3 py-1 bg-orange-500 text-white text-sm font-medium rounded hover:bg-orange-600 transition-colors whitespace-nowrap"
                    >
                      Recalculate
                    </button>
                    <span className="text-xs text-orange-600">Current: 1 USD = {vndRate.toLocaleString()} VND</span>
                  </>
                )}
                <button
                  onClick={handleStartOver}
                  className="ml-auto px-3 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium rounded transition-colors whitespace-nowrap"
                >
                  Start Over
                </button>
              </div>

              {/* View toggle: campaigns vs flat adsets */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAdsetOnly((v) => !v)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${showAdsetOnly ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                >
                  {showAdsetOnly ? '← Show Campaigns' : 'Show Ad Sets Only'}
                </button>
                {showAdsetOnly && selectedFlatAdsets.length > 0 && (
                  <button
                    onClick={() => setShowBulkModal(true)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 transition-colors"
                  >
                    Change Budget ({selectedFlatAdsets.length} ad set{selectedFlatAdsets.length !== 1 ? 's' : ''})
                  </button>
                )}
                <button
                  onClick={() => setShowExportModal(true)}
                  className="ml-auto px-3 py-1.5 text-xs font-medium rounded-lg border bg-white text-slate-700 border-slate-300 hover:bg-slate-50 transition-colors"
                >
                  ↓ Export Spend by App
                </button>
              </div>

              <AppsflyerRevenueStatus
                summary={appsflyer.summary}
                warnings={appsflyer.warnings}
                error={appsflyer.error}
                mapping={appsflyer.mapping}
                onReplace={handleAppsflyerReplace}
              />

              {/* Snapshot save + multi-compare selector */}
              <SnapshotToolbar
                snapshots={snapshots}
                comparedIds={comparedSnapshotIds}
                onAdd={handleAddSnapshot}
                onRemove={handleRemoveSnapshot}
                onSave={appsflyer.revenueIncomplete ? async () => {} : handleSaveSnapshot}
                onDelete={handleDeleteSnapshot}
                saving={savingSnapshot}
              />
              {/* A snapshot of partial revenue would make every later delta wrong. */}
              {appsflyer.revenueIncomplete && (
                <p className="text-xs text-amber-700">Saving snapshots is disabled until AppsFlyer revenue is fully matched (see the AppsFlyer status above).</p>
              )}
              {snapshotError && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  <span>Snapshot error: {snapshotError}</span>
                  <button onClick={() => setSnapshotError('')} className="text-red-400 hover:text-red-700 ml-auto">✕</button>
                </div>
              )}

              {/* Unified filter bar — always shown */}
              <FilterBar
                campaignName={campaignNameFilter}
                onCampaignNameChange={setCampaignNameFilter}
                campaignNameKeywords={campaignNameKeywords}
                onAddKeyword={handleAddCampaignKeyword}
                onRemoveKeyword={handleRemoveCampaignKeyword}
                statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
                selectedApps={appNameFilter}
                onSelectedAppsChange={setAppNameFilter}
                appOptions={appOptions}
                accountFilter={accountFilter}
                onAccountFilterChange={setAccountFilter}
                accountOptions={accountOptions}
                roasMin={roasMin} roasMax={roasMax}
                onRoasMinChange={setRoasMin} onRoasMaxChange={setRoasMax}
                spendMin={spendMin} spendMax={spendMax}
                onSpendMinChange={setSpendMin} onSpendMaxChange={setSpendMax}
                budgetMin={budgetMin} budgetMax={budgetMax}
                onBudgetMinChange={setBudgetMin} onBudgetMaxChange={setBudgetMax}
                totalCount={mergedCampaigns.length}
                filteredCount={displayedCampaigns.length}
                onClearAll={() => {
                  setCampaignNameFilter(''); setCampaignNameKeywords([]); setAppNameFilter([]); setAccountFilter('');
                  setRoasMin(''); setRoasMax('');
                  setSpendMin(''); setSpendMax('');
                  setBudgetMin(''); setBudgetMax('');
                  setStatusFilter('all');
                }}
              />

            </div>

            {showAdsetOnly && flatAdsetsError && (
              <div className="mb-2 flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                <span>{flatAdsetsError}</span>
                <button onClick={() => setFlatAdsetsError('')} className="text-red-400 hover:text-red-700 ml-auto">✕</button>
              </div>
            )}

            {/* Table area — fixed viewport-relative height; scrolls internally on both axes */}
            <div className="h-[calc(100vh-340px)] min-h-[420px] overflow-hidden pb-3">
              {/* Campaign table */}
              {!showAdsetOnly && (
                <CampaignTable
                  campaigns={displayedCampaigns}
                  selectedIds={selectedIds}
                  onSelectionChange={setSelectedIds}
                  sortCol={sortCol}
                  sortDir={sortDir}
                  onSort={handleSort}
                  showAccountColumn={accountOptions.length > 1}
                  adjustAdSetMap={adjustAdSetMapState}
                  adjustAllRevAdSetMap={adjustAllRevAdSetMapState}
                  campaignRev={campaignRev}
                  vndRate={vndRate}
                  snapshotComparisons={snapshotComparisons}
                  zoom={zoom}
                />
              )}

              {/* Flat adset view */}
              {showAdsetOnly && (
                loadingAllAdsets ? (
                  <div className="h-full flex items-center justify-center bg-white border border-slate-200 rounded-xl text-sm text-slate-400">
                    Loading ad sets from {campaignsForStatus.length} campaign{campaignsForStatus.length !== 1 ? 's' : ''}…
                  </div>
                ) : (
                  <AdsetFlatView
                    adsets={displayedFlatAdsets}
                    selectedIds={selectedFlatAdsetIds}
                    onSelectionChange={setSelectedFlatAdsetIds}
                    vndRate={vndRate}
                    showAccountColumn={accountOptions.length > 1}
                    snapshotComparisons={snapshotComparisons}
                    zoom={zoom}
                    onBudgetUpdated={refreshFlatAdsetsOf}
                  />
                )
              )}
            </div>
          </div>
        )}
      </main>

      {phase === 'results' && selectedCampaigns.length > 0 && !showAdsetOnly && (
        <ActionBar
          selectedCampaigns={selectedCampaigns}
          allAccounts={selectedAccounts}
          onActionComplete={() => { if (appsflyer.parsed) { setPhase('analyzing'); handleAnalyze(); } }}
          onDeselect={() => setSelectedIds(new Set())}
          vndRate={vndRate}
        />
      )}

      {showExportModal && (
        <ExportSpendModal
          vndRate={vndRate}
          viewingStaffId={viewingStaffId}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {showBulkModal && selectedFlatAdsets.length > 0 && (
        <AdsetBulkBudgetModal
          adsets={selectedFlatAdsets}
          vndRate={vndRate}
          snapshotComparisons={snapshotComparisons}
          onClose={() => setShowBulkModal(false)}
          onApplied={() => {
            setShowBulkModal(false);
            loadAllAdsets(campaignsForStatus);
          }}
        />
      )}
    </div>
  );
}
