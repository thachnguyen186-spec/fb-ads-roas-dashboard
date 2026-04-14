/**
 * FB Marketing API v21 ad set actions: budget update.
 * All calls are server-side only — token never exposed to browser.
 * Budget values are converted from USD to cents (FB API expects cents).
 */

import { fbPatch } from './fb-client';

/**
 * Updates the daily or lifetime budget for an ad set.
 * @param amountUsd - New budget in USD (converted to cents internally)
 */
export async function updateAdSetBudget(
  token: string,
  adsetId: string,
  budgetType: 'daily' | 'lifetime',
  amountUsd: number,
): Promise<void> {
  const cents = Math.round(amountUsd * 100);
  const field = budgetType === 'daily' ? 'daily_budget' : 'lifetime_budget';
  await fbPatch(`/${adsetId}`, { [field]: String(cents) }, token);
}
