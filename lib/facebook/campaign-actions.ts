/**
 * FB Marketing API v21 campaign actions: pause and budget update.
 * All calls are server-side only — token never exposed to browser.
 * Budget values are converted from USD to cents (FB API expects cents).
 */

import { fbPatch } from './fb-client';

/**
 * Pauses a campaign by setting its status to PAUSED.
 */
export async function pauseCampaign(token: string, campaignId: string): Promise<void> {
  await fbPatch(`/${campaignId}`, { status: 'PAUSED' }, token);
}

/**
 * Updates the daily or lifetime budget for a campaign.
 * FB API expects budgets in the account's smallest currency unit:
 *   - USD → cents (multiply × 100)
 *   - VND → VND (no sub-unit, send as-is)
 * @param amount   - New budget in the account's native currency
 * @param currency - ISO currency code, e.g. 'USD' or 'VND'
 */
export async function updateBudget(
  token: string,
  campaignId: string,
  budgetType: 'daily' | 'lifetime',
  amount: number,
  currency: string,
): Promise<void> {
  const fbValue = currency === 'VND' ? Math.round(amount) : Math.round(amount * 100);
  const field = budgetType === 'daily' ? 'daily_budget' : 'lifetime_budget';
  await fbPatch(`/${campaignId}`, { [field]: String(fbValue) }, token);
}
