/**
 * User-scoped maintenance of `tiktok_ad_accounts` rows (keyed advertiser_id + user_id).
 * Every read/write/delete here is filtered by user_id — one user's sync or resync must
 * never touch another user's advertiser rows or selections.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { fetchAdvertiserInfo } from './advertiser-info';

interface StoredRow { advertiser_id: string; name: string; currency: string }

/**
 * Upserts the user's granted advertisers (never touching is_selected) and deletes the user's
 * rows no longer granted. An empty advertiserIds is treated as a failed sync (throws) rather
 * than "you now have zero accounts" — a scope hiccup must not silently wipe every selection.
 */
export async function syncUserAdvertisers(userId: string, advertiserIds: string[], token: string): Promise<void> {
  if (advertiserIds.length === 0) {
    throw new Error('TikTok authorization returned zero advertiser accounts.');
  }

  const service = createServiceClient();
  const { info } = await fetchAdvertiserInfo(advertiserIds, token);
  const { data: storedRows, error: selectError } = await service
    .from('tiktok_ad_accounts')
    .select('advertiser_id,name,currency')
    .eq('user_id', userId);
  // Must not proceed blind: an empty `stored` would let the 'USD' fallback overwrite real currencies.
  if (selectError) throw new Error(selectError.message);
  const stored = new Map(((storedRows ?? []) as StoredRow[]).map((r) => [r.advertiser_id, r]));

  // Unresolved lookups keep the stored name/currency — never overwrite a real currency with the
  // 'USD' fallback (that would bypass the USD-only selection gate). 'USD' only seeds brand-new rows.
  const rows = advertiserIds.map((id) => ({
    advertiser_id: id,
    user_id: userId,
    name: info.get(id)?.name ?? stored.get(id)?.name ?? id,
    currency: info.get(id)?.currency ?? stored.get(id)?.currency ?? 'USD',
  }));
  // is_selected intentionally omitted: existing rows keep their selection, new rows default true.
  const { error } = await service.from('tiktok_ad_accounts').upsert(rows, { onConflict: 'advertiser_id,user_id' });
  if (error) throw new Error(error.message);

  const granted = new Set(advertiserIds);
  const staleIds = [...stored.keys()].filter((id) => !granted.has(id));
  if (staleIds.length > 0) {
    const { error: deleteError } = await service
      .from('tiktok_ad_accounts')
      .delete()
      .eq('user_id', userId)
      .in('advertiser_id', staleIds);
    if (deleteError) throw new Error(deleteError.message);
  }
}

/**
 * Refreshes name/currency for the user's already-connected advertisers with their stored
 * token — no OAuth round-trip, so selections survive. Only rows TikTok actually resolved are
 * written: a failed lookup never overwrites a stored name with the raw id, or stamps 'USD'
 * over a real currency (name-only fallback results keep the stored currency).
 */
export async function resyncUserAdvertiserNames(
  userId: string,
  token: string,
): Promise<{ updated: number; total: number; errors: string[] }> {
  const service = createServiceClient();
  const { data, error: selectError } = await service
    .from('tiktok_ad_accounts')
    .select('advertiser_id,currency')
    .eq('user_id', userId);
  if (selectError) throw new Error(selectError.message);
  const existing = (data ?? []) as { advertiser_id: string; currency: string }[];
  if (existing.length === 0) return { updated: 0, total: 0, errors: [] };

  const { info, errors } = await fetchAdvertiserInfo(existing.map((r) => r.advertiser_id), token);
  const rows = existing
    .filter((r) => info.has(r.advertiser_id))
    .map((r) => {
      const resolved = info.get(r.advertiser_id)!;
      return { advertiser_id: r.advertiser_id, user_id: userId, name: resolved.name, currency: resolved.currency ?? r.currency };
    });
  if (rows.length > 0) {
    // is_selected intentionally omitted — existing rows keep their current selection.
    const { error } = await service.from('tiktok_ad_accounts').upsert(rows, { onConflict: 'advertiser_id,user_id' });
    if (error) throw new Error(error.message);
  }

  return { updated: rows.length, total: existing.length, errors };
}
