'use client';

/**
 * AppsFlyer revenue for the FB campaign hub: holds the parsed CSV, maps its ad IDs to FB
 * campaign/ad set via POST /api/campaigns/ad-map, and exposes the same revenue maps the hub,
 * tables, snapshots and filters already consume. Nothing is stored server-side.
 *
 * A sequence counter (bumped by every mapping and by reset) drops superseded responses, so a slow
 * old mapping never overwrites a newer file or shows up after switching the viewed user.
 */

import { useMemo, useRef, useState } from 'react';
import {
  aggregateAllRevByAdSetId, aggregateAllRevByCampaignId, aggregateAppByCampaignId,
  aggregateByAdSetId, aggregateByCampaignId,
} from '@/lib/adjust/csv-parser';
import type { AppsflyerLevel, AppsflyerParseResult } from '@/lib/appsflyer/appsflyer-csv-parser';
import { campaignFilePlacements, toRevenueRows, type AdPlacement } from '@/lib/appsflyer/appsflyer-revenue-rows';
import type { AdjustRow, CampaignRow } from '@/lib/types';

export interface RevenueMaps {
  /** Revenue by campaign — ROAS numerator */
  campaignRev: Map<string, number>;
  /** Revenue by campaign — %Profit / Profit (same figure for AppsFlyer) */
  campaignAllRev: Map<string, number>;
  adsetRev: Map<string, number>;
  adsetAllRev: Map<string, number>;
  /** campaign_id → app name, for the App filter */
  appByCampaign: Map<string, string>;
}

export interface AppsflyerMatchSummary {
  /** Whether the counts below are ads or campaigns. */
  level: AppsflyerLevel;
  /** File rows (ads or campaigns) matched to one of the loaded campaigns. */
  matchedAds: number;
  /** Numeric IDs in the file (all media sources). */
  totalAds: number;
  matchedRevenue: number;
  /** IDs Excel turned into scientific notation — their revenue cannot be matched. */
  corruptedAds: number;
}

interface AdMapResponse {
  placements?: Record<string, AdPlacement>;
  warnings?: string[];
  error?: string;
}

interface Placements {
  placements: Record<string, AdPlacement>;
  warnings: string[];
}

type CacheEntry = { parsed: AppsflyerParseResult; viewAs: string | null } & Placements;

/** Revenue rows of the last successful mapping, with the file they came from. */
interface AppliedMatch {
  source: AppsflyerParseResult;
  rows: AdjustRow[];
}

function buildMaps(rows: AdjustRow[]): RevenueMaps {
  return {
    campaignRev: aggregateByCampaignId(rows),
    campaignAllRev: aggregateAllRevByCampaignId(rows),
    adsetRev: aggregateByAdSetId(rows),
    adsetAllRev: aggregateAllRevByAdSetId(rows),
    appByCampaign: aggregateAppByCampaignId(rows),
  };
}

async function fetchPlacements(parsed: AppsflyerParseResult, viewAs: string | null): Promise<Placements> {
  if (parsed.level === 'campaign') return { placements: campaignFilePlacements(parsed.rows), warnings: [] };
  const res = await fetch('/api/campaigns/ad-map', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ad_ids: parsed.rows.map((r) => r.id), ...(viewAs ? { viewAs } : {}) }),
  });
  // Platform timeouts return non-JSON bodies — fall back to the HTTP status.
  const data = await res.json().catch(() => ({})) as AdMapResponse;
  if (!res.ok) throw new Error(data.error ?? `Mapping AppsFlyer ads to campaigns failed (${res.status})`);
  return { placements: data.placements ?? {}, warnings: data.warnings ?? [] };
}

/** `campaigns`: the FB campaigns on screen — the match summary only counts ads in those. */
export function useAppsflyerRevenue(campaigns: CampaignRow[]) {
  const [parsed, setParsedState] = useState<AppsflyerParseResult | null>(null);
  const [applied, setApplied] = useState<AppliedMatch | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [mapping, setMapping] = useState(false);
  /** Bumped on reset so the upload drop zone remounts empty. */
  const [uploadKey, setUploadKey] = useState(0);
  // Mirrors `parsed` so a mapping started from an older render still uses the newest file.
  const parsedRef = useRef<AppsflyerParseResult | null>(null);
  const seqRef = useRef(0);
  // Ad → campaign placements are stable within a session; reuse them on re-analyze of the same file.
  const cacheRef = useRef<CacheEntry | null>(null);
  /** Cache entry whose revenue is currently published (null after a failure or reset). */
  const publishedRef = useRef<CacheEntry | null>(null);

  const maps = useMemo(() => buildMaps(applied?.rows ?? []), [applied]);

  const summary = useMemo<AppsflyerMatchSummary | null>(() => {
    if (!applied) return null;
    const campaignIds = new Set(campaigns.map((c) => c.campaign_id));
    let matchedAds = 0;
    let matchedRevenue = 0;
    for (const row of applied.rows) {
      if (!campaignIds.has(row.campaign_id)) continue;
      matchedAds++; // toRevenueRows emits one row per file row
      matchedRevenue += row.revenue;
    }
    return { level: applied.source.level, matchedAds, totalAds: applied.source.rows.length, matchedRevenue, corruptedAds: applied.source.corruptedRows };
  }, [applied, campaigns]);

  function setParsed(next: AppsflyerParseResult | null) {
    parsedRef.current = next;
    setParsedState(next);
  }

  /**
   * Maps `source` (default: the latest loaded file) to campaigns and publishes the revenue maps.
   * Never rejects: a failure clears the revenue and sets `error`; a superseded call changes nothing.
   */
  async function applyRevenue(viewAs: string | null, source: AppsflyerParseResult | null = parsedRef.current): Promise<void> {
    const mySeq = ++seqRef.current;
    if (!source) {
      publishedRef.current = null;
      setApplied(null);
      setError('Upload an AppsFlyer CSV first.');
      setMapping(false);
      return;
    }
    setParsed(source);
    setMapping(true);
    setError('');
    try {
      const cached = cacheRef.current;
      // A partial result (warnings) is retried on the next Analyze instead of being reused.
      const hit = cached && cached.parsed === source && cached.viewAs === viewAs && cached.warnings.length === 0 ? cached : null;
      const { placements, warnings: mapWarnings } = hit ?? await fetchPlacements(source, viewAs);
      if (mySeq !== seqRef.current) return;
      // Same file + user already published: keep the maps' identity so nothing downstream reloads.
      if (hit && hit === publishedRef.current) return;
      const entry = { parsed: source, viewAs, placements, warnings: mapWarnings };
      cacheRef.current = entry;
      publishedRef.current = entry;
      setApplied({ source, rows: toRevenueRows(source.rows, placements).rows });
      setWarnings(mapWarnings);
    } catch (err) {
      if (mySeq !== seqRef.current) return;
      publishedRef.current = null;
      setApplied(null);
      setWarnings([]);
      setError(err instanceof Error ? err.message : 'Failed to map AppsFlyer ads');
    } finally {
      if (mySeq === seqRef.current) setMapping(false);
    }
  }

  function reset() {
    seqRef.current++;
    setParsed(null);
    setApplied(null);
    setWarnings([]);
    setError('');
    setMapping(false);
    setUploadKey((k) => k + 1);
    cacheRef.current = null;
    publishedRef.current = null;
  }

  /** Revenue is incomplete while mapping, after a failed mapping, or when some accounts could not be read. */
  const revenueIncomplete = mapping || !!error || warnings.length > 0;

  return { parsed, setParsed, maps, summary, warnings, error, mapping, revenueIncomplete, uploadKey, applyRevenue, reset };
}
