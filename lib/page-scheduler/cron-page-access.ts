/**
 * Per-run page token cache for cron jobs. A page whose token cannot be resolved (or that hit an
 * auth error) is remembered as unusable so the rest of the run skips it. Tokens never leave
 * this module's callers (never logged/returned).
 */

import { createServiceClient } from '@/lib/supabase/server';
import { getPageToken, markProfileInvalid } from './fb-profiles';

export const pageKey = (userId: string, pageId: string) => `${userId}|${pageId}`;

export function groupByPage<T extends { user_id: string; page_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = pageKey(r.user_id, r.page_id);
    const list = map.get(k);
    if (list) list.push(r); else map.set(k, [r]);
  }
  return map;
}

/** Keys of pages with a usable token: row exists, is_active, profile not invalid. */
export async function loadUsablePageKeys(): Promise<Set<string>> {
  const usable = new Set<string>();
  const size = 1000;
  for (let p = 0; p < 20; p++) {
    const { data, error } = await createServiceClient().from('ps_pages')
      .select('user_id, page_id, ps_fb_profiles(status)').eq('is_active', true).order('id').range(p * size, p * size + size - 1);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as unknown as { user_id: string; page_id: string; ps_fb_profiles: { status: string } | { status: string }[] | null }[]) {
      const profile = Array.isArray(r.ps_fb_profiles) ? r.ps_fb_profiles[0] : r.ps_fb_profiles;
      if (profile?.status !== 'invalid') usable.add(pageKey(r.user_id, r.page_id));
    }
    if ((data?.length ?? 0) < size) break;
  }
  return usable;
}

const SCAN_PAGE = 300;
const MAX_SCAN_PAGES = 5;

/**
 * Collects up to `limit` candidate rows whose page has a usable token, scanning ordered pages so
 * token-less pages cannot starve the limit. Rows of unusable pages are handed to `onUnusable`
 * once, after the scan (so mutating them cannot shift the paging).
 */
export async function collectUsableRows<T extends { user_id: string; page_id: string }>(
  usable: Set<string>, limit: number,
  fetchPage: (from: number, to: number) => Promise<T[]>,
  onUnusable?: (rows: T[]) => Promise<void>,
): Promise<T[]> {
  const out: T[] = [];
  const unusable: T[] = [];
  for (let p = 0; p < MAX_SCAN_PAGES && out.length < limit; p++) {
    const rows = await fetchPage(p * SCAN_PAGE, p * SCAN_PAGE + SCAN_PAGE - 1);
    for (const r of rows) {
      if (!usable.has(pageKey(r.user_id, r.page_id))) unusable.push(r);
      else if (out.length < limit) out.push(r);
    }
    if (rows.length < SCAN_PAGE) break;
  }
  if (unusable.length && onUnusable) await onUnusable(unusable);
  return out;
}

export function createPageAccess() {
  const tokens = new Map<string, string | null>();
  return {
    /** Page token or null when unavailable (not connected / inactive / invalid profile). */
    async token(userId: string, pageId: string): Promise<string | null> {
      const k = pageKey(userId, pageId);
      if (tokens.has(k)) return tokens.get(k) ?? null;
      let t: string | null = null;
      try { t = await getPageToken(userId, pageId); } catch { t = null; }
      tokens.set(k, t);
      return t;
    },
    /** FB said the token is dead (190): flag the profile and stop using this page this run. */
    async invalidate(userId: string, pageId: string, message: string): Promise<void> {
      tokens.set(pageKey(userId, pageId), null);
      const { data } = await createServiceClient().from('ps_pages').select('profile_id').eq('user_id', userId).eq('page_id', pageId).maybeSingle();
      const profileId = (data as { profile_id?: string } | null)?.profile_id;
      if (profileId) await markProfileInvalid(profileId, message).catch(() => {});
    },
  };
}

export type PageAccess = ReturnType<typeof createPageAccess>;
