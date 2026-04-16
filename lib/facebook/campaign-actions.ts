/**
 * FB Marketing API v21 campaign actions: pause and budget update.
 * All calls are server-side only — token never exposed to browser.
 * Budget values are converted from USD to cents (FB API expects cents).
 */

import { fbGet, fbPatch, fbPostForm } from './fb-client';

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
 * Strategy: shallow campaign copy + per-adset copies (avoids `deep_copy=1` which
 * requires elevated FB app permissions and causes OAuthException for standard tokens).
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
  // Step 1: Shallow-copy the campaign (no deep_copy — it requires elevated FB app permissions).
  // rename_options also omitted for the same reason; name is patched in step 2.
  let newId: string;
  try {
    const copyRes = await fbPostForm(`/${campaignId}/copies`, {
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

  // Step 4: Fetch original ad sets and copy each one into the new campaign.
  // POST /{adset_id}/copies with campaign_id works with standard ads_management permission.
  let originalAdSets: Array<{ id: string; name: string }>;
  try {
    const res = await fbGet(`/${campaignId}/adsets`, {
      fields: 'id,name',
      limit: '200',
    }, token) as { data: Array<{ id: string; name: string }> };
    originalAdSets = res.data ?? [];
  } catch (err) {
    throw stepError('fetch original adsets', err);
  }

  // Copy each adset into the new campaign; track original_name → new_adset_id for budget patching
  const copiedAdSetIds = new Map<string, string>();
  for (const adset of originalAdSets) {
    try {
      const copyRes = await fbPostForm(`/${adset.id}/copies`, {
        campaign_id: newId,
        status_option: 'PAUSED',
      }, token) as { copied_adset_id: string };
      copiedAdSetIds.set(adset.name, copyRes.copied_adset_id);
    } catch (err) {
      throw stepError(`copy adset "${adset.name}"`, err);
    }
  }

  // Step 5: Patch adset-level budgets using the copied adset IDs (same names preserved)
  if (adsetBudgets && adsetBudgets.length > 0) {
    for (const budget of adsetBudgets) {
      const newAdSetId = copiedAdSetIds.get(budget.name);
      if (!newAdSetId) continue;
      const fbValue = budget.currency === 'VND'
        ? Math.round(budget.amount)
        : Math.round(budget.amount * 100);
      const field = budget.type === 'daily' ? 'daily_budget' : 'lifetime_budget';
      try {
        await fbPatch(`/${newAdSetId}`, { [field]: String(fbValue) }, token);
      } catch (err) {
        // Skip gracefully: CBO campaigns control budget at campaign level, so
        // setting ad set budgets is invalid. Campaign was already created; user
        // can adjust budgets manually if needed.
        console.warn(`[duplicateCampaign] skipping adset budget for "${budget.name}": ${err instanceof Error ? err.message : String(err)}`);
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
