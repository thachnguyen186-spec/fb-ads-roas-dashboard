/**
 * FB Marketing API v21 campaign actions: pause and budget update.
 * All calls are server-side only — token never exposed to browser.
 * Budget values are converted from USD to cents (FB API expects cents).
 */

import { fbGet, fbPatch } from './fb-client';

export type AdsetBudgetSpec = {
  name: string;
  amount: number;
  type: 'daily' | 'lifetime';
  currency: string;
};

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
function stepError(step: string, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(`[${step}] ${msg}`);
}

export async function duplicateCampaignSameAccount(
  token: string,
  campaignId: string,
  name: string,
  budgetOverride?: { amount: number; type: 'daily' | 'lifetime'; currency: string },
  adsetBudgets?: AdsetBudgetSpec[],
): Promise<string> {
  // Step 1: Deep-copy the campaign (creates new campaign + adsets + ads, starts PAUSED)
  // rename_options omitted — requires elevated API access; name is patched in step 2
  let newId: string;
  try {
    const copyRes = await fbPatch(`/${campaignId}/copies`, {
      deep_copy: 'true',
      status_option: 'PAUSED',
    }, token) as { copied_campaign_id: string };
    newId = copyRes.copied_campaign_id;
  } catch (err) {
    throw stepError('create copy', err);
  }

  // Step 2: Set the user-specified name on the new campaign
  try {
    await fbPatch(`/${newId}`, { name }, token);
  } catch (err) {
    throw stepError(`rename campaign ${newId}`, err);
  }

  // Step 3: Apply campaign-level budget override if provided
  if (budgetOverride) {
    const fbValue = budgetOverride.currency === 'VND'
      ? Math.round(budgetOverride.amount)
      : Math.round(budgetOverride.amount * 100);
    const field = budgetOverride.type === 'daily' ? 'daily_budget' : 'lifetime_budget';
    try {
      await fbPatch(`/${newId}`, { [field]: String(fbValue) }, token);
    } catch (err) {
      throw stepError(`set campaign budget (${field})`, err);
    }
  }

  // Step 4: Patch adset-level budgets — match new adsets by name (deep copy preserves names)
  if (adsetBudgets && adsetBudgets.length > 0) {
    let newAdSets: Array<{ id: string; name: string }>;
    try {
      const adSetsRes = await fbGet(`/${newId}/adsets`, {
        fields: 'id,name',
        limit: '200',
      }, token) as { data: Array<{ id: string; name: string }> };
      newAdSets = adSetsRes.data ?? [];
    } catch (err) {
      throw stepError('fetch new adsets for budget patch', err);
    }

    for (const budget of adsetBudgets) {
      const match = newAdSets.find((a) => a.name === budget.name);
      if (!match) continue;
      const fbValue = budget.currency === 'VND'
        ? Math.round(budget.amount)
        : Math.round(budget.amount * 100);
      const field = budget.type === 'daily' ? 'daily_budget' : 'lifetime_budget';
      try {
        await fbPatch(`/${match.id}`, { [field]: String(fbValue) }, token);
      } catch (err) {
        throw stepError(`set adset budget for "${budget.name}"`, err);
      }
    }
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
