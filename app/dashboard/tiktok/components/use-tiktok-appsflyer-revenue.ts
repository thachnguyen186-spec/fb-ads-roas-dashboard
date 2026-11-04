'use client';

/** Holds the uploaded AppsFlyer file and turns it into revenue rows for the fetched TikTok campaigns.
 * The file lives in the browser for this session only. Mapping (ad -> campaign/ad group) runs via
 * /api/tiktok/ad-map whenever a file is uploaded or campaigns are refetched; placements are cached
 * per (file, viewed user) so a refetch only asks about what is still unknown. A sequence counter
 * drops stale responses so a slow old mapping never overwrites a newer one (same as the hub's fetchSeq). */

import { useRef, useState } from 'react';
import { campaignFilePlacements, toRevenueRows, type AdPlacement, type AppsflyerMatchResult } from '@/lib/appsflyer/appsflyer-revenue-rows';
import type { AppsflyerParseResult } from '@/lib/appsflyer/appsflyer-csv-parser';
import type { TiktokCampaignRow } from '@/lib/types';

async function fetchPlacements(adIds: string[], advertiserIds: string[], viewAs: string | null): Promise<Record<string, AdPlacement>> {
  const res = await fetch('/api/tiktok/ad-map', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ad_ids: adIds, advertiser_ids: advertiserIds, ...(viewAs ? { viewAs } : {}) }),
  });
  // Platform timeouts return non-JSON bodies — fall back to the HTTP status.
  const data = await res.json().catch(() => null) as { placements?: Record<string, AdPlacement>; error?: string } | null;
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  if (!data?.placements || typeof data.placements !== 'object') throw new Error('Malformed ad-map response');
  return data.placements;
}

/** Placements found so far for one (file, viewed user). Ad → campaign placement never changes. */
interface PlacementCache {
  file: AppsflyerParseResult;
  viewAs: string | null;
  placements: Record<string, AdPlacement>;
  /** Advertisers already asked for every ad id that is still unresolved. */
  scanned: Set<string>;
}

export function useTiktokAppsflyerRevenue() {
  const [file, setFileState] = useState<AppsflyerParseResult | null>(null);
  const [match, setMatch] = useState<AppsflyerMatchResult | null>(null);
  const [mapping, setMapping] = useState(false);
  const [error, setError] = useState('');
  // Ref mirrors `file` so a campaign fetch that started before the upload still maps the latest file.
  const fileRef = useRef<AppsflyerParseResult | null>(null);
  const seq = useRef(0);
  const cacheRef = useRef<PlacementCache | null>(null);

  function setFile(next: AppsflyerParseResult | null) {
    fileRef.current = next;
    setFileState(next);
  }

  /** Placements for `campaigns`' advertisers. Only unresolved ids are sent, and only to advertisers
   * not yet scanned for them, so a refetch after a campaign action usually needs no request.
   * A "by Campaign ID" file needs no request at all. */
  async function resolvePlacements(current: AppsflyerParseResult, campaigns: TiktokCampaignRow[], viewAs: string | null) {
    if (current.level === 'campaign') return campaignFilePlacements(current.rows);
    const prev = cacheRef.current;
    const cache: PlacementCache = prev && prev.file === current && prev.viewAs === viewAs
      ? prev
      : { file: current, viewAs, placements: {}, scanned: new Set() };
    cacheRef.current = cache;
    const known = cache.placements;
    const advertisers = [...new Set(campaigns.map((c) => c.advertiser_id))].filter((id) => !cache.scanned.has(id));
    const unresolved = current.rows.map((r) => r.id).filter((id) => !known[id]);
    if (advertisers.length > 0 && unresolved.length > 0) {
      Object.assign(known, await fetchPlacements(unresolved, advertisers, viewAs));
    }
    for (const id of advertisers) cache.scanned.add(id);
    return known;
  }

  /** Re-maps the current file onto `campaigns`. Keeps the previous match visible while mapping. */
  async function apply(campaigns: TiktokCampaignRow[], viewAs: string | null) {
    const mySeq = ++seq.current;
    const current = fileRef.current;
    setError('');
    if (!current || campaigns.length === 0) {
      setMatch(null);
      setMapping(false);
      return;
    }
    setMapping(true);
    try {
      const placements = await resolvePlacements(current, campaigns, viewAs);
      if (mySeq !== seq.current) return;
      // Only ads in the fetched campaigns count — revenue of campaigns not shown would never be displayed.
      const campaignIds = new Set(campaigns.map((c) => c.campaign_id));
      const scoped = Object.fromEntries(Object.entries(placements).filter(([, p]) => campaignIds.has(p.campaign_id)));
      setMatch(toRevenueRows(current.rows, scoped));
    } catch (err) {
      if (mySeq !== seq.current) return;
      setMatch(null);
      setError(err instanceof Error ? err.message : 'Failed to match AppsFlyer ads');
    } finally {
      if (mySeq === seq.current) setMapping(false);
    }
  }

  /** Drops the current match (e.g. switching viewed user) but keeps the uploaded file. */
  function clearMatch() {
    seq.current++;
    setMatch(null);
    setMapping(false);
    setError('');
  }

  /** Revenue is "missing" until a file is mapped successfully — snapshots are blocked meanwhile. */
  const revenueMissing = !match || mapping || !!error;

  return { file, match, mapping, error, revenueMissing, setFile, apply, clearMatch };
}
