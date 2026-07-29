/**
 * Enriches advertiser IDs with name/currency via TikTok's /advertiser/info/ endpoint.
 * Extracted from the OAuth callback so the same chunked-call logic can be reused by a
 * standalone "resync names" action (no full OAuth round-trip needed to refresh stale names).
 */
import { tiktokGet } from './tiktok-client';
import { chunk } from '@/lib/utils';

interface RawAdvertiserInfo {
  advertiser_id: string;
  name?: string;
  currency?: string;
}

/** TikTok rejects /advertiser/info/ outright ("Length must be between 1 and 100") past this
 * many IDs in one call — confirmed via TikTok's own validation error on an org with 112
 * selected advertisers, which silently fell back to id-as-name for every single one. */
const ADVERTISER_INFO_CHUNK_SIZE = 100;

/** Best-effort enrichment — falls back to id-as-name / 'USD' per batch if a lookup fails or a field is missing. */
export async function fetchAdvertiserInfo(
  advertiserIds: string[],
  token: string,
): Promise<Map<string, { name: string; currency: string }>> {
  const map = new Map<string, { name: string; currency: string }>();
  for (const batch of chunk(advertiserIds, ADVERTISER_INFO_CHUNK_SIZE)) {
    try {
      const data = await tiktokGet<{ list: RawAdvertiserInfo[] }>('/advertiser/info/', {
        advertiser_ids: JSON.stringify(batch),
        fields: JSON.stringify(['name', 'currency']),
      }, token);
      if (!data.list?.length) {
        console.warn('[tiktok] /advertiser/info/ returned no list entries for a batch — response keys:', Object.keys(data));
      }
      for (const info of data.list ?? []) {
        if (!info.name) console.warn(`[tiktok] /advertiser/info/ entry for ${info.advertiser_id} has no name field — keys:`, Object.keys(info));
        map.set(info.advertiser_id, { name: info.name ?? info.advertiser_id, currency: info.currency ?? 'USD' });
      }
    } catch (err) {
      // Non-fatal — enrichment can be re-run on the next reconnect/resync. Logged so a real
      // cause is diagnosable instead of silently falling back to id-as-name for this batch.
      console.error('[tiktok] /advertiser/info/ lookup failed for a batch, falling back to id-as-name:', err);
    }
  }
  return map;
}
