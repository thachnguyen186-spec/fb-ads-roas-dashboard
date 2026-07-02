/**
 * Builds a campaign_id → app_id map by scanning an ad account's ad sets for
 * promoted_object.application_id.
 *
 * Why ad sets (not campaigns): for app-promotion campaigns the app is defined at
 * the ad-set level, so the campaign object's own promoted_object is usually empty.
 * One paginated edge call per account — minimal fields keep the payload small.
 */

import { fbGet } from './fb-client';

interface RawAdSetAppRow {
  campaign_id?: string;
  promoted_object?: { application_id?: string };
}

interface RawPage {
  data: RawAdSetAppRow[];
  paging?: { cursors?: { after?: string }; next?: string };
}

/**
 * Returns campaign_id → app_id for every ad set that promotes an app.
 * First non-null app_id per campaign wins (a campaign promotes a single app).
 */
export async function fetchCampaignAppIds(
  token: string,
  adAccountId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let after: string | undefined;

  do {
    const params: Record<string, string> = {
      fields: 'campaign_id,promoted_object{application_id}',
      limit: '500',
    };
    if (after) params.after = after;

    const page = await fbGet(`/${adAccountId}/adsets`, params, token) as RawPage;
    for (const row of page.data ?? []) {
      const cid = row.campaign_id;
      const appId = row.promoted_object?.application_id;
      if (cid && appId && !map.has(cid)) map.set(cid, appId);
    }

    after = page.paging?.cursors?.after;
    if (!page.paging?.next) break;
  } while (after);

  return map;
}
