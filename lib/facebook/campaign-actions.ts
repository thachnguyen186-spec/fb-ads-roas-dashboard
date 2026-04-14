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
 * @param amountUsd - New budget in USD (converted to cents internally)
 */
export async function updateBudget(
  token: string,
  campaignId: string,
  budgetType: 'daily' | 'lifetime',
  amountUsd: number,
): Promise<void> {
  const cents = Math.round(amountUsd * 100);
  const field = budgetType === 'daily' ? 'daily_budget' : 'lifetime_budget';
  await fbPatch(`/${campaignId}`, { [field]: String(cents) }, token);
}
