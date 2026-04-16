/**
 * Pure functions for spending-limit alert decisions.
 * No I/O — easy to unit test independently of cron route.
 */
import type { SpendingLimitRow } from '@/lib/facebook/spending-limits';

export type AlertDecision =
  | { kind: 'fire'; reason: 'crossed_below' }
  | { kind: 'reset'; reason: 'recovered' }
  | { kind: 'noop' };

/** Decide whether to fire, reset, or do nothing for a given account state. */
export function decideAlert(
  remaining: number | null,
  threshold: number | null,
  alertSent: boolean,
): AlertDecision {
  if (remaining === null || threshold === null) return { kind: 'noop' };
  if (remaining < threshold && !alertSent) return { kind: 'fire', reason: 'crossed_below' };
  if (remaining >= threshold && alertSent) return { kind: 'reset', reason: 'recovered' };
  return { kind: 'noop' };
}

/** Escape Telegram legacy Markdown special characters in user-controlled strings. */
function escMd(s: string): string {
  return s.replace(/[_*`\[]/g, '\\$&');
}

/** Build the Telegram message text for a threshold-crossing alert. */
export function buildAlertMessage(opts: {
  userEmail: string;
  account: SpendingLimitRow;
  threshold: number;
}): string {
  const { userEmail, account, threshold } = opts;
  // USD is stored in cents — display as dollars. Other currencies (VND etc.) as-is.
  const display = (n: number) =>
    account.currency === 'USD'
      ? `$${(n / 100).toFixed(2)}`
      : Math.round(n).toLocaleString('en-US') + ` ${account.currency}`;

  return [
    `*⚠️ Spending Limit Alert*`,
    `User: ${escMd(userEmail)}`,
    `Account: ${escMd(account.name)} (${escMd(account.account_id)})`,
    `Spend cap: ${display(account.spend_cap ?? 0)}`,
    `Spent: ${display(account.amount_spent)}`,
    `Remaining: ${display(account.remaining ?? 0)}`,
    `Threshold: ${display(threshold)}`,
  ].join('\n');
}
