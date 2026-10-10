/**
 * Pulls the Pages a profile token can manage (`GET /me/accounts`, paged) and upserts them into
 * ps_pages with encrypted page tokens. Throws on Graph errors — callers (fb-profiles.ts) decide
 * how to react (e.g. mark the profile invalid on code 190).
 */

import { fbGet, PAGE_SCHEDULER_FB_API_BASE } from '@/lib/facebook/fb-client';
import { encryptToken } from '@/lib/crypto/token-crypto';
import { createServiceClient } from '@/lib/supabase/server';

interface RawPage {
  id: string;
  name?: string;
  category?: string;
  picture?: { data?: { url?: string } };
  access_token?: string;
  tasks?: string[];
}

interface AccountsResponse {
  data?: RawPage[];
  paging?: { cursors?: { after?: string }; next?: string };
}

export interface SyncResult {
  pages_total: number;
  pages_added: number;
}

const ACCOUNT_FIELDS = 'id,name,category,picture{url},access_token,tasks';
const MAX_PAGES_PER_SYNC = 50; // pagination safety cap (5000 Pages)

async function fetchAllAccounts(userToken: string): Promise<RawPage[]> {
  const all: RawPage[] = [];
  let after: string | undefined;
  for (let i = 0; i < MAX_PAGES_PER_SYNC; i++) {
    const params: Record<string, string> = { fields: ACCOUNT_FIELDS, limit: '100' };
    if (after) params.after = after;
    const res = await fbGet('/me/accounts', params, userToken, PAGE_SCHEDULER_FB_API_BASE) as AccountsResponse;
    all.push(...(res.data ?? []));
    after = res.paging?.cursors?.after;
    if (!res.paging?.next || !after) break;
  }
  return all;
}

const hasCreateContent = (tasks: string[] | null | undefined) => !!tasks?.includes('CREATE_CONTENT');

/**
 * Syncs one profile's Pages. Dedupe: one row per (user, page_id). If the Page already belongs to
 * another profile that has CREATE_CONTENT and this profile lacks it, the existing row is kept.
 * Rows of THIS profile no longer returned are deactivated.
 */
export async function syncPagesForProfile(userId: string, profileId: string, userToken: string): Promise<SyncResult> {
  const accounts = (await fetchAllAccounts(userToken)).filter((p) => p.id && p.access_token);

  const service = createServiceClient();
  const { data: existingData, error: exErr } = await service
    .from('ps_pages')
    .select('page_id, profile_id, tasks')
    .eq('user_id', userId);
  if (exErr) throw new Error(exErr.message);
  const existing = new Map(
    ((existingData ?? []) as { page_id: string; profile_id: string; tasks: string[] }[]).map((r) => [r.page_id, r]),
  );

  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  let added = 0;
  for (const p of accounts) {
    const tasks = Array.isArray(p.tasks) ? p.tasks : [];
    const prev = existing.get(p.id);
    if (prev && prev.profile_id !== profileId && hasCreateContent(prev.tasks) && !hasCreateContent(tasks)) continue;
    if (!prev) added++;
    rows.push({
      user_id: userId,
      profile_id: profileId,
      page_id: p.id,
      name: p.name ?? '',
      category: p.category ?? null,
      picture_url: p.picture?.data?.url ?? null,
      tasks,
      page_token_enc: encryptToken(p.access_token as string, userId),
      is_active: true,
      synced_at: now,
      updated_at: now,
    });
  }

  if (rows.length) {
    const { error } = await service.from('ps_pages').upsert(rows, { onConflict: 'user_id,page_id' });
    if (error) throw new Error(error.message);
  }

  // Deactivate this profile's rows that FB no longer returns.
  const returned = new Set(accounts.map((p) => p.id));
  const { data: mine, error: mineErr } = await service
    .from('ps_pages')
    .select('page_id')
    .eq('profile_id', profileId)
    .eq('is_active', true);
  if (mineErr) throw new Error(mineErr.message);
  const stale = ((mine ?? []) as { page_id: string }[]).map((r) => r.page_id).filter((id) => !returned.has(id));
  if (stale.length) {
    const { error } = await service
      .from('ps_pages')
      .update({ is_active: false, updated_at: now })
      .eq('profile_id', profileId)
      .in('page_id', stale);
    if (error) throw new Error(error.message);
  }

  return { pages_total: rows.length, pages_added: added };
}
