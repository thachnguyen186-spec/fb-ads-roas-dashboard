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
 * Enables (turns on) a campaign by setting its status to ACTIVE.
 */
export async function enableCampaign(token: string, campaignId: string): Promise<void> {
  await fbPatch(`/${campaignId}`, { status: 'ACTIVE' }, token);
}

/**
 * Duplicates a campaign within the same account via FB Copies API.
 * Copies campaign + ad sets + ads (deep_copy=true), starts PAUSED.
 * Then patches the copy with a custom name and optional budget override.
 * Returns the new campaign ID.
 */
export async function duplicateCampaignSameAccount(
  token: string,
  campaignId: string,
  name: string,
  budgetOverride?: { amount: number; type: 'daily' | 'lifetime'; currency: string },
): Promise<string> {
  const copyRes = await fbPatch(`/${campaignId}/copies`, {
    deep_copy: 'true',
    status_option: 'PAUSED',
    rename_options: JSON.stringify({ rename_strategy: 'ONLY_TOP_LEVEL_RENAME' }),
  }, token) as { copied_campaign_id: string };

  const newId = copyRes.copied_campaign_id;

  // Set the user-specified name on the copy
  await fbPatch(`/${newId}`, { name }, token);

  // Apply budget override if provided
  if (budgetOverride) {
    const fbValue = budgetOverride.currency === 'VND'
      ? Math.round(budgetOverride.amount)
      : Math.round(budgetOverride.amount * 100);
    const field = budgetOverride.type === 'daily' ? 'daily_budget' : 'lifetime_budget';
    await fbPatch(`/${newId}`, { [field]: String(fbValue) }, token);
  }

  return newId;
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
