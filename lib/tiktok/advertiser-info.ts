/**
 * Enriches advertiser IDs with name/currency via TikTok's /advertiser/info/ endpoint.
 * Extracted from the OAuth callback so the same chunked-call logic can be reused by a
 * standalone "resync names" action (no full OAuth round-trip needed to refresh stale names).
 *
 * /advertiser/info/ needs the "Ad Account Management" scope on the TikTok developer app. When
 * the token lacks it (TikTok error 40001), names fall back to /oauth2/advertiser/get/, which
 * any authorized token can call (auth = app_id + secret) but returns name only, no currency.
 */
import { tiktokGet } from './tiktok-client';
import { chunk } from '@/lib/utils';

interface RawAdvertiserInfo {
  advertiser_id: string;
  name?: string;
  currency?: string;
}

interface RawAuthorizedAdvertiser {
  advertiser_id: string;
  advertiser_name?: string;
}

/** currency is undefined when only the name-only fallback resolved this advertiser. */
export interface AdvertiserInfo {
  name: string;
  currency?: string;
}

export interface AdvertiserInfoResult {
  info: Map<string, AdvertiserInfo>;
  /** Human-readable causes of failed lookups — surfaced to the UI instead of being swallowed. */
  errors: string[];
}

/** TikTok rejects /advertiser/info/ outright ("Length must be between 1 and 100") past this
 * many IDs in one call — confirmed via TikTok's own validation error on an org with 112
 * selected advertisers, which silently fell back to id-as-name for every single one. */
const ADVERTISER_INFO_CHUNK_SIZE = 100;

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Name-only lookup of every advertiser the token is authorized for (single call, no chunking). */
async function fetchAuthorizedAdvertiserNames(token: string): Promise<Map<string, string>> {
  const appId = process.env.TIKTOK_APP_ID;
  const secret = process.env.TIKTOK_APP_SECRET;
  if (!appId || !secret) throw new Error('TIKTOK_APP_ID/TIKTOK_APP_SECRET not configured on server.');

  const data = await tiktokGet<{ list?: RawAuthorizedAdvertiser[] }>(
    '/oauth2/advertiser/get/',
    { app_id: appId, secret },
    token,
  );
  const names = new Map<string, string>();
  for (const a of data.list ?? []) {
    if (a.advertiser_name) names.set(String(a.advertiser_id), a.advertiser_name);
  }
  return names;
}

/** Best-effort enrichment — IDs missing from `info` could not be resolved (see `errors`). */
export async function fetchAdvertiserInfo(advertiserIds: string[], token: string): Promise<AdvertiserInfoResult> {
  const info = new Map<string, AdvertiserInfo>();
  const errors: string[] = [];

  for (const batch of chunk(advertiserIds, ADVERTISER_INFO_CHUNK_SIZE)) {
    try {
      const data = await tiktokGet<{ list: RawAdvertiserInfo[] }>('/advertiser/info/', {
        advertiser_ids: JSON.stringify(batch),
        fields: JSON.stringify(['name', 'currency']),
      }, token);
      for (const row of data.list ?? []) {
        if (row.name) info.set(String(row.advertiser_id), { name: row.name, currency: row.currency });
      }
    } catch (err) {
      console.error('[tiktok] /advertiser/info/ lookup failed for a batch:', err);
      errors.push(`/advertiser/info/: ${errMessage(err)}`);
    }
  }

  const missing = advertiserIds.filter((id) => !info.has(id));
  if (missing.length === 0) return { info, errors: [] };

  try {
    const names = await fetchAuthorizedAdvertiserNames(token);
    for (const id of missing) {
      const name = names.get(id);
      if (name) info.set(id, { name });
    }
  } catch (err) {
    console.error('[tiktok] /oauth2/advertiser/get/ fallback failed:', err);
    errors.push(`/oauth2/advertiser/get/: ${errMessage(err)}`);
  }

  // Every failed 100-ID batch repeats the same TikTok message — show each cause once.
  return { info, errors: [...new Set(errors)] };
}
