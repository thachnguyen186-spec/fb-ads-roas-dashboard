/**
 * TikTok Business API v1.3 campaign/ad group actions: status + budget updates.
 * All calls are server-side only — token never exposed to browser.
 * Status batch endpoints cap at 100 IDs per request — chunked automatically.
 *
 * Upgraded Smart+ campaigns/ad groups reject the standard endpoints ("This API does not support
 * Upgraded Smart Plus ads.") and must use /smart_plus/* (paths + fields per TikTok's official
 * tiktok-business-api-sdk yml specs). Each action tries the standard endpoint first and falls
 * back to Smart+ only on that specific rejection.
 */

import { tiktokPost } from './tiktok-client';
import { chunk } from '@/lib/utils';

const BATCH_CHUNK_SIZE = 100;
// Narrow on purpose: only TikTok's exact Upgraded Smart+ rejection may trigger the fallback.
const SMART_PLUS_REJECTION = /does not support upgraded smart\s*(\+|plus)/i;

type Status = 'ENABLE' | 'DISABLE';

function isSmartPlusRejection(err: unknown): boolean {
  return err instanceof Error && SMART_PLUS_REJECTION.test(err.message);
}

/** Runs the standard call; on a Smart+ rejection runs the Smart+ equivalent instead. */
async function withSmartPlusFallback(standard: () => Promise<unknown>, smartPlus: () => Promise<unknown>): Promise<void> {
  try {
    await standard();
  } catch (err) {
    if (!isSmartPlusRejection(err)) throw err;
    await smartPlus();
  }
}

/**
 * Batched status update. A batch mixing Smart+ and standard IDs is rejected as a whole, so on a
 * Smart+ rejection the batch is retried one ID at a time, each with its own fallback.
 */
async function updateStatusBatched(
  ids: string[],
  standardBatch: (batch: string[]) => Promise<unknown>,
  smartPlusBatch: (batch: string[]) => Promise<unknown>,
): Promise<void> {
  for (const batch of chunk(ids, BATCH_CHUNK_SIZE)) {
    try {
      await standardBatch(batch);
    } catch (err) {
      if (!isSmartPlusRejection(err)) throw err;
      // A single-ID batch is known to be Smart+ — don't repeat the call that just failed.
      if (batch.length === 1) { await smartPlusBatch(batch); continue; }
      for (const id of batch) {
        await withSmartPlusFallback(() => standardBatch([id]), () => smartPlusBatch([id]));
      }
    }
  }
}

export async function updateCampaignBudget(token: string, advertiserId: string, campaignId: string, budget: number): Promise<void> {
  const body = { advertiser_id: advertiserId, campaign_id: campaignId, budget };
  await withSmartPlusFallback(
    () => tiktokPost('/campaign/update/', body, token),
    () => tiktokPost('/smart_plus/campaign/update/', body, token),
  );
}

export async function updateCampaignStatus(token: string, advertiserId: string, campaignIds: string[], status: Status): Promise<void> {
  await updateStatusBatched(
    campaignIds,
    (batch) => tiktokPost('/campaign/status/update/', { advertiser_id: advertiserId, campaign_ids: batch, status }, token),
    (batch) => tiktokPost('/smart_plus/campaign/status/update/', { advertiser_id: advertiserId, campaign_ids: batch, operation_status: status }, token),
  );
}

export async function updateAdGroupBudget(token: string, advertiserId: string, adgroupId: string, budget: number): Promise<void> {
  const body = { advertiser_id: advertiserId, adgroup_id: adgroupId, budget };
  await withSmartPlusFallback(
    () => tiktokPost('/adgroup/update/', body, token),
    () => tiktokPost('/smart_plus/adgroup/update/', body, token),
  );
}

export async function updateAdGroupStatus(token: string, advertiserId: string, adgroupIds: string[], status: Status): Promise<void> {
  await updateStatusBatched(
    adgroupIds,
    (batch) => tiktokPost('/adgroup/status/update/', { advertiser_id: advertiserId, adgroup_ids: batch, status }, token),
    (batch) => tiktokPost('/smart_plus/adgroup/status/update/', { advertiser_id: advertiserId, adgroup_ids: batch, operation_status: status }, token),
  );
}
