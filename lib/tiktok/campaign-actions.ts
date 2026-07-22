/**
 * TikTok Business API v1.3 campaign/ad group actions: status + budget updates.
 * All calls are server-side only — token never exposed to browser.
 * Status batch endpoints cap at 100 IDs per request — chunked automatically.
 */

import { tiktokPost } from './tiktok-client';
import { chunk } from '@/lib/utils';

const BATCH_CHUNK_SIZE = 100;

export async function updateCampaignBudget(
  token: string,
  advertiserId: string,
  campaignId: string,
  budget: number,
): Promise<void> {
  await tiktokPost('/campaign/update/', { advertiser_id: advertiserId, campaign_id: campaignId, budget }, token);
}

export async function updateCampaignStatus(
  token: string,
  advertiserId: string,
  campaignIds: string[],
  status: 'ENABLE' | 'DISABLE',
): Promise<void> {
  for (const batch of chunk(campaignIds, BATCH_CHUNK_SIZE)) {
    await tiktokPost('/campaign/status/update/', { advertiser_id: advertiserId, campaign_ids: batch, status }, token);
  }
}

export async function updateAdGroupBudget(
  token: string,
  advertiserId: string,
  adgroupId: string,
  budget: number,
): Promise<void> {
  await tiktokPost('/adgroup/update/', { advertiser_id: advertiserId, adgroup_id: adgroupId, budget }, token);
}

export async function updateAdGroupStatus(
  token: string,
  advertiserId: string,
  adgroupIds: string[],
  status: 'ENABLE' | 'DISABLE',
): Promise<void> {
  for (const batch of chunk(adgroupIds, BATCH_CHUNK_SIZE)) {
    await tiktokPost('/adgroup/status/update/', { advertiser_id: advertiserId, adgroup_ids: batch, status }, token);
  }
}
