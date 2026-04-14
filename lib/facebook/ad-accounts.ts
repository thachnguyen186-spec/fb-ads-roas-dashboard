/**
 * Fetches all Facebook Ad Accounts accessible by the given user token.
 * Uses /me/adaccounts endpoint with pagination.
 */

import { fbGet } from './fb-client';
import type { FbAdAccount } from '@/lib/types';

interface RawAdAccount {
  id: string;            // "act_XXXXX"
  name: string;
  account_status: number;
}

interface RawPageResponse {
  data: RawAdAccount[];
  paging?: { cursors?: { after?: string }; next?: string };
}

export async function fetchAdAccounts(token: string): Promise<FbAdAccount[]> {
  const accounts: FbAdAccount[] = [];
  let after: string | undefined;

  do {
    const params: Record<string, string> = {
      fields: 'id,name,account_status',
      limit: '100',
    };
    if (after) params.after = after;

    const page = await fbGet('/me/adaccounts', params, token) as RawPageResponse;
    for (const raw of page.data ?? []) {
      accounts.push({
        account_id: raw.id,
        name: raw.name,
        is_selected: true,
        account_status: raw.account_status,
      });
    }

    after = page.paging?.cursors?.after;
    if (!page.paging?.next) break;
  } while (after);

  return accounts;
}
