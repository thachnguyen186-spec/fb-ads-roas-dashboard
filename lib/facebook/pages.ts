/**
 * Lists Facebook Pages reachable by the AFS launch token (`GET /me/accounts`).
 * Cursor-paginated, mirrors lib/facebook/ad-accounts.ts. Uses AFS_FB_API_BASE (v22.0) — see
 * fb-client.ts for why AFS write/read calls are pinned to a newer version than the rest
 * of the app.
 */

import { fbGet, AFS_FB_API_BASE } from './fb-client';
import type { FbPage } from '@/lib/types';

interface RawPage {
  id: string;
  name: string;
}

interface RawPageResponse {
  data: RawPage[];
  paging?: { cursors?: { after?: string }; next?: string };
}

/** Matches FB's permission-error shape ("(#200) ..." / OAuthException) for pages_show_list gaps. */
function isPermissionError(message: string): boolean {
  return /permission|OAuthException|\(#200\)/i.test(message);
}

export async function fetchPages(token: string): Promise<FbPage[]> {
  const pages: FbPage[] = [];
  let after: string | undefined;

  try {
    do {
      const params: Record<string, string> = { fields: 'id,name', limit: '100' };
      if (after) params.after = after;

      const page = await fbGet('/me/accounts', params, token, AFS_FB_API_BASE) as RawPageResponse;
      for (const raw of page.data ?? []) {
        pages.push({ id: raw.id, name: raw.name });
      }

      after = page.paging?.cursors?.after;
      if (!page.paging?.next) break;
    } while (after);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isPermissionError(msg)) {
      throw new Error('Facebook Pages unavailable — your launch token is missing pages_show_list. Re-verify it in Settings.');
    }
    throw err;
  }

  return pages;
}
