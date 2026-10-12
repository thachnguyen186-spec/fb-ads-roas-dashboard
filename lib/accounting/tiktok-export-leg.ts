import { createServiceClient } from '@/lib/supabase/server';
import { chunk } from '@/lib/utils';
import type { InsightDateParam } from '@/lib/facebook/campaigns';
import { fetchCampaigns as fetchTiktokCampaigns } from '@/lib/tiktok/campaigns';
import { fetchSpend } from '@/lib/tiktok/reporting';
import { fetchCampaignTargets } from '@/lib/tiktok/campaign-target';
import { getValidAccessToken, describeAuthError } from '@/lib/tiktok/tiktok-connection';
import { buildTiktokRows, presetToRange, type OwnerLabels } from '@/lib/accounting/build-rows';
import { runBatched, CONCURRENCY, type LegResult } from '@/lib/accounting/run-batched';
import type { AccountingExportRow } from '@/lib/types';

interface Advertiser { advertiser_id: string; name: string; currency: string; ownerIds: string[] }

/** TikTok export leg: advertisers connected by visible users, deduped, fetched with an owner's own token. */
export async function tiktokLeg(visibleIds: string[], dateParam: InsightDateParam, ownerMap: Map<string, OwnerLabels>): Promise<LegResult> {
  const rows: AccountingExportRow[] = [];
  const warnings: string[] = [];

  const service = createServiceClient();
  const { data, error } = await service
    .from('tiktok_ad_accounts')
    .select('advertiser_id, user_id, name, currency')
    .in('user_id', visibleIds);
  if (error) {
    warnings.push(`tiktok: failed to load advertiser accounts — ${error.message}`);
    return { rows, warnings, partial: false };
  }

  const byAdvertiser = new Map<string, Advertiser>();
  for (const r of (data ?? []) as { advertiser_id: string; user_id: string; name: string; currency: string }[]) {
    const existing = byAdvertiser.get(r.advertiser_id);
    if (existing) {
      if (!existing.ownerIds.includes(r.user_id)) existing.ownerIds.push(r.user_id);
    } else {
      byAdvertiser.set(r.advertiser_id, { advertiser_id: r.advertiser_id, name: r.name, currency: r.currency, ownerIds: [r.user_id] });
    }
  }
  const advertisers = [...byAdvertiser.values()];

  // Resolve one token per distinct owner (DB read; refresh only when needed).
  const owners = [...new Set(advertisers.flatMap((a) => a.ownerIds))];
  const tokenByUser = new Map<string, string>();
  for (const batch of chunk(owners, CONCURRENCY)) {
    const results = await Promise.allSettled(batch.map((uid) => getValidAccessToken(uid)));
    results.forEach((res, i) => {
      if (res.status === 'fulfilled') tokenByUser.set(batch[i], res.value);
      else warnings.push(`tiktok: user ${batch[i]}: ${describeAuthError(res.reason).message}`);
    });
  }

  // Every usable owner token, in order: a token revoked at TikTok only fails on the API call,
  // so the job falls back to the next co-owner's token instead of dropping the advertiser.
  const jobs: { adv: Advertiser; tokens: string[] }[] = [];
  for (const adv of advertisers) {
    const tokens = adv.ownerIds.filter((uid) => tokenByUser.has(uid)).map((uid) => tokenByUser.get(uid)!);
    if (tokens.length > 0) jobs.push({ adv, tokens });
    else warnings.push(`tiktok ${adv.advertiser_id}: no valid owner token`);
  }

  const range = presetToRange(dateParam);
  if ('preset' in dateParam && dateParam.preset === 'maximum') {
    warnings.push("tiktok: 'maximum' capped at 1 year — TikTok's Reporting API has no open-ended range");
  }

  const partial = await runBatched(jobs, async ({ adv, tokens }) => {
    let lastErr: unknown;
    for (const token of tokens) {
      try {
        const [campaigns, spendMap, targetMap] = await Promise.all([
          fetchTiktokCampaigns(token, adv.advertiser_id, adv.name, adv.currency),
          fetchSpend(token, adv.advertiser_id, 'CAMPAIGN', range),
          fetchCampaignTargets(token, adv.advertiser_id),
        ]);
        rows.push(...buildTiktokRows(campaigns, spendMap, targetMap, ownerMap, adv.advertiser_id, adv.name, adv.currency));
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(`tiktok ${adv.advertiser_id}: ${message}`);
  }, warnings);

  return { rows, warnings, partial };
}
