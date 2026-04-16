/**
 * Fetches spending-limit data for an array of FB ad account IDs in parallel.
 * Per-account failures are isolated — they appear as { account_id, error } rows
 * so a single bad account does not break the batch.
 *
 * FB API returns spend_cap and amount_spent as strings in the account's smallest
 * currency unit (USD = cents, VND = as-is). spend_cap '0' means "no cap set".
 */

import { fbGet } from './fb-client';

export interface SpendingLimitRow {
  account_id: string;        // "act_XXXXX"
  name: string;
  currency: string;
  /** Smallest currency unit (USD cents, VND units). null when account has no cap. */
  spend_cap: number | null;
  /** Smallest currency unit. */
  amount_spent: number;
  /** spend_cap - amount_spent; null when spend_cap is null. */
  remaining: number | null;
  /** 0–100; null when spend_cap is null or 0. */
  percent_used: number | null;
}

export interface SpendingLimitError {
  account_id: string;
  error: string;
}

export type SpendingLimitResult = SpendingLimitRow | SpendingLimitError;

interface RawAccount {
  id?: string;
  name?: string;
  currency?: string;
  spend_cap?: string;
  amount_spent?: string;
}

function toRow(accountId: string, raw: RawAccount): SpendingLimitRow {
  const cap = raw.spend_cap ? parseFloat(raw.spend_cap) : 0;
  const spent = raw.amount_spent ? parseFloat(raw.amount_spent) : 0;
  // FB returns '0' for "no cap" → treat as null (unlimited)
  const spend_cap = cap > 0 ? cap : null;
  const remaining = spend_cap !== null ? spend_cap - spent : null;
  const percent_used =
    spend_cap !== null && spend_cap > 0 ? (spent / spend_cap) * 100 : null;
  return {
    account_id: accountId,
    name: raw.name ?? accountId,
    currency: raw.currency ?? 'USD',
    spend_cap,
    amount_spent: spent,
    remaining,
    percent_used,
  };
}

export async function fetchSpendingLimits(
  token: string,
  accountIds: string[],
): Promise<SpendingLimitResult[]> {
  return Promise.all(
    accountIds.map(async (id) => {
      try {
        const raw = (await fbGet(
          `/${id}`,
          { fields: 'spend_cap,amount_spent,currency,name' },
          token,
        )) as RawAccount;
        return toRow(id, raw);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown FB error';
        return { account_id: id, error: msg };
      }
    }),
  );
}

export function isSpendingLimitError(
  r: SpendingLimitResult,
): r is SpendingLimitError {
  return 'error' in r;
}
