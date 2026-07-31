/**
 * AFS Niche Testing — single-step publish state machine (Phase 03).
 * Each call advances exactly ONE step (create campaign, OR create adset, OR publish one
 * creative) and persists its result before returning. Re-reads topic/creatives/batch from the
 * DB on every call — never trusts state from a prior invocation. The caller (the publish API
 * route) loops, calling this repeatedly until the response reports `done: true`.
 */

import { randomUUID } from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { getLaunchToken } from '@/lib/afs/launch-token';
import { pauseCampaign } from '@/lib/facebook/campaign-actions';
import { createCampaign, createAdSet, createAdCreative, createAd } from '@/lib/facebook/ad-creation';
import { uploadAdImage } from '@/lib/facebook/ad-images';
import type { AfsTopic, AfsCreative, AfsBatch, AfsPublishResult, AfsTopicStatus } from '@/lib/types';

/** Thrown when a concurrent call (a second tab, a duplicated retry) already holds this step's claim. */
const CONCURRENT_PUBLISH_ERROR = 'Another publish call is already in progress for this topic — retry in a moment.';

type ServiceClient = ReturnType<typeof createServiceClient>;

/** Shared with the publish route's own defense-in-depth check — keeps the message in one place. */
export const ALREADY_PUBLISHED_ERROR =
  'Topic already has a live campaign (fb_campaign_id set) — cannot re-publish. Contact an admin if this campaign needs to be replaced.';

export interface PublishStepResult {
  done: boolean;
  step?: 'campaign' | 'adset' | 'creative';
  creativeIndex?: number;
  result?: AfsPublishResult;
}

function stepError(step: string, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(`[${step}] ${msg}`);
}

/**
 * Persists a patch immediately after a successful FB create call. If the write fails, the FB
 * object id is never swallowed — it's folded into the thrown error (and best-effort recorded
 * on the row's `error` column) so it surfaces to logs/UI instead of silently orphaning the
 * FB object with no local record of it.
 */
async function persistOrThrow(
  service: ServiceClient,
  table: 'afs_topics' | 'afs_creatives',
  id: string,
  patch: Record<string, unknown>,
  fbObjectDescription: string,
): Promise<void> {
  const { error } = await service.from(table).update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (!error) return;

  const message = `${fbObjectDescription} succeeded on Facebook but failed to persist to the database: ${error.message}. This object may be orphaned — check manually before retrying.`;
  try {
    await service.from(table).update({ error: message, updated_at: new Date().toISOString() }).eq('id', id);
  } catch {
    // Best-effort only — the thrown error below still surfaces the FB id regardless.
  }
  throw new Error(message);
}

export async function publishStep(userId: string, topicId: string): Promise<PublishStepResult> {
  const token = await getLaunchToken(userId);
  const service = createServiceClient();

  const { data: topicRow, error: topicErr } = await service
    .from('afs_topics')
    .select('*')
    .eq('id', topicId)
    .eq('user_id', userId)
    .single();
  if (topicErr || !topicRow) throw new Error('Topic not found');
  const topic = topicRow as AfsTopic;

  // [Red Team Fix] Even if some future bypass lets a "published" topic reach this call again,
  // never touch a topic that already has a live campaign from a completed publish — refuse
  // outright rather than risk adding surprise ads to an old campaign/adset.
  if (topic.fb_campaign_id && topic.status === 'published') {
    throw new Error(ALREADY_PUBLISHED_ERROR);
  }

  const { data: batchRow, error: batchErr } = await service
    .from('afs_batches')
    .select('*')
    .eq('id', topic.batch_id)
    .single();
  if (batchErr || !batchRow) throw new Error('Batch not found for this topic');
  const batch = batchRow as AfsBatch;

  const { data: creativesData, error: creativesErr } = await service
    .from('afs_creatives')
    .select('*')
    .eq('topic_id', topicId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (creativesErr) throw new Error(`Failed to load creatives: ${creativesErr.message}`);
  // afs_creatives has no `position` column (only afs_topics does) — created_at/id ascending
  // order is the deterministic stand-in for "lowest position first".
  const creatives = (creativesData ?? []) as AfsCreative[];

  // The ONLY place this is decided — never client-supplied, recomputed fresh every call.
  const targetStatus: 'ACTIVE' | 'PAUSED' = batch.publish_active ? 'ACTIVE' : 'PAUSED';

  // Step 1: campaign
  if (!topic.fb_campaign_id) {
    if (!topic.ad_account_id) throw new Error('Topic is missing an ad account — cannot publish.');

    // Server-side defense-in-depth: budget should already be capped at intake/edit time, but this
    // is the last checkpoint before real spend, so re-verify rather than trust upstream layers.
    const ceilingRaw = Number(process.env.AFS_MAX_DAILY_BUDGET_MINOR);
    const ceiling = Number.isFinite(ceilingRaw) && ceilingRaw > 0 ? ceilingRaw : 500_000;
    if (topic.daily_budget_minor > ceiling) {
      throw new Error(`Topic's daily budget (${topic.daily_budget_minor}) exceeds the maximum allowed (${ceiling}) — cannot publish.`);
    }

    // Atomic claim: a sentinel (not a real FB id) written via a conditional UPDATE makes this a
    // single-writer gate with no schema change — a second concurrent call (another tab, a
    // duplicated retry) sees 0 rows affected and backs off instead of creating a second campaign.
    const claimToken = `claiming:${randomUUID()}`;
    const { data: claimed, error: claimErr } = await service
      .from('afs_topics')
      .update({ fb_campaign_id: claimToken, status: 'publishing' satisfies AfsTopicStatus, updated_at: new Date().toISOString() })
      .eq('id', topicId)
      .is('fb_campaign_id', null)
      .select('id')
      .maybeSingle();
    if (claimErr) throw new Error(`Failed to claim campaign step: ${claimErr.message}`);
    if (!claimed) throw new Error(CONCURRENT_PUBLISH_ERROR);

    let campaignId: string;
    try {
      const res = await createCampaign(token, {
        accountId: topic.ad_account_id,
        name: `AFS: ${topic.topic_text}`.slice(0, 200),
        status: targetStatus,
        specialAdCategories: topic.special_ad_category === 'NONE' ? [] : [topic.special_ad_category],
      });
      campaignId = res.id;
    } catch (err) {
      // Release the claim so a retry can attempt campaign creation again.
      await service.from('afs_topics').update({ fb_campaign_id: null, updated_at: new Date().toISOString() }).eq('id', topicId).eq('fb_campaign_id', claimToken);
      throw stepError('create campaign', err);
    }

    await persistOrThrow(service, 'afs_topics', topicId, { fb_campaign_id: campaignId }, `Campaign ${campaignId}`);
    return { done: false, step: 'campaign' };
  }

  // A claim sentinel (see above) means someone else's create-campaign call is mid-flight right now.
  if (topic.fb_campaign_id.startsWith('claiming:')) throw new Error(CONCURRENT_PUBLISH_ERROR);
  const campaignId = topic.fb_campaign_id;

  // Step 2: adset
  if (!topic.fb_adset_id) {
    if (!topic.ad_account_id) throw new Error('Topic is missing an ad account — cannot publish.');
    if (!topic.countries || topic.countries.length === 0) throw new Error('Topic has no target countries — cannot publish.');

    const claimToken = `claiming:${randomUUID()}`;
    const { data: claimed, error: claimErr } = await service
      .from('afs_topics')
      .update({ fb_adset_id: claimToken, updated_at: new Date().toISOString() })
      .eq('id', topicId)
      .is('fb_adset_id', null)
      .select('id')
      .maybeSingle();
    if (claimErr) throw new Error(`Failed to claim adset step: ${claimErr.message}`);
    if (!claimed) throw new Error(CONCURRENT_PUBLISH_ERROR);

    let adsetId: string;
    try {
      const res = await createAdSet(token, {
        accountId: topic.ad_account_id,
        campaignId,
        name: `AFS AdSet: ${topic.topic_text}`.slice(0, 200),
        dailyBudgetMinor: topic.daily_budget_minor,
        countries: topic.countries,
        status: targetStatus,
        pixelId: topic.pixel_id,
      });
      adsetId = res.id;
    } catch (err) {
      await service.from('afs_topics').update({ fb_adset_id: null, updated_at: new Date().toISOString() }).eq('id', topicId).eq('fb_adset_id', claimToken);
      throw stepError('create adset', err);
    }

    await persistOrThrow(service, 'afs_topics', topicId, { fb_adset_id: adsetId }, `AdSet ${adsetId}`);
    return { done: false, step: 'adset' };
  }

  if (topic.fb_adset_id.startsWith('claiming:')) throw new Error(CONCURRENT_PUBLISH_ERROR);
  const adsetId = topic.fb_adset_id;

  // Step 3: one creative (image upload → adcreative → ad)
  const candidate = creatives.find((c) => c.status === 'succeeded' && !c.fb_ad_id && !c.error);
  if (candidate) {
    const creativeIndex = creatives.indexOf(candidate);

    // Same atomic-claim pattern as the campaign/adset steps — prevents two concurrent calls from
    // both picking this creative and double-uploading/double-creating its ad.
    const claimToken = `claiming:${randomUUID()}`;
    const { data: claimedCreative, error: claimErr } = await service
      .from('afs_creatives')
      .update({ fb_ad_id: claimToken, updated_at: new Date().toISOString() })
      .eq('id', candidate.id)
      .is('fb_ad_id', null)
      .select('id')
      .maybeSingle();
    if (claimErr) throw new Error(`Failed to claim creative step: ${claimErr.message}`);
    if (!claimedCreative) {
      // Someone else already claimed this creative — let the caller retry; the next call picks
      // whichever creative is unclaimed once the other call finishes.
      return { done: false, step: 'creative', creativeIndex };
    }

    try {
      if (!topic.ad_account_id) throw new Error('Topic is missing an ad account — cannot publish.');
      if (!topic.page_id) throw new Error('Topic is missing a Facebook Page — cannot publish.');
      const accountId = topic.ad_account_id;
      const pageId = topic.page_id;

      let imageHash = candidate.fb_image_hash;
      if (!imageHash) {
        if (!candidate.storage_path) throw new Error(`Creative ${candidate.id} has no stored image`);
        const { data: fileBlob, error: dlErr } = await service.storage
          .from('afs-creatives')
          .download(candidate.storage_path);
        if (dlErr || !fileBlob) throw stepError('download image', dlErr ?? new Error('no data returned'));

        const bytes = Buffer.from(await fileBlob.arrayBuffer());
        try {
          imageHash = await uploadAdImage(token, accountId, bytes, `${candidate.id}.png`);
        } catch (err) {
          throw stepError('upload image', err);
        }
        await persistOrThrow(service, 'afs_creatives', candidate.id, { fb_image_hash: imageHash }, `Image hash ${imageHash}`);
      }

      let creativeId = candidate.fb_creative_id;
      if (!creativeId) {
        try {
          const res = await createAdCreative(token, {
            accountId,
            pageId,
            targetUrl: topic.target_url,
            primaryText: topic.primary_text,
            adHeadline: topic.ad_headline,
            imageHash,
          });
          creativeId = res.id;
        } catch (err) {
          throw stepError('create ad creative', err);
        }
        await persistOrThrow(service, 'afs_creatives', candidate.id, { fb_creative_id: creativeId }, `Ad creative ${creativeId}`);
      }

      let adId: string;
      try {
        const res = await createAd(token, {
          accountId,
          adsetId,
          name: `AFS Ad: ${candidate.style_key}`,
          creativeId,
          status: targetStatus,
        });
        adId = res.id;
      } catch (err) {
        throw stepError('create ad', err);
      }
      await persistOrThrow(service, 'afs_creatives', candidate.id, { fb_ad_id: adId }, `Ad ${adId}`);
    } catch (err) {
      // Record the error and move on — the client keeps calling; the next call's candidate
      // selection (`!c.error`) skips this creative rather than retrying it forever.
      const message = err instanceof Error ? err.message : String(err);
      try {
        // Clear the claim sentinel back to null — leaving it in place would make this row look
        // like it has a real ad (`created_ads: creatives.filter(c => c.fb_ad_id)` would miscount it).
        await service.from('afs_creatives')
          .update({ fb_ad_id: null, error: message, updated_at: new Date().toISOString() })
          .eq('id', candidate.id);
      } catch {
        // Best-effort — the failure is still visible via this response's absence of progress.
      }
    }
    return { done: false, step: 'creative', creativeIndex };
  }

  // A creative stuck with a claim sentinel means some call (possibly one that crashed mid-flight)
  // is or was mid-claim for it — never finalize as 'published' on top of that ambiguity; surface a
  // retryable error instead. (A live concurrent call would also hit this on its own next read.)
  if (creatives.some((c) => c.fb_ad_id?.startsWith('claiming:'))) throw new Error(CONCURRENT_PUBLISH_ERROR);

  // No more creatives to attempt — finalize.
  const hasFailure = creatives.some((c) => c.error);
  const finalStatus: AfsTopicStatus = hasFailure ? 'partial_failed' : 'published';
  const finalizeError = hasFailure
    ? 'One or more creatives failed to publish — see per-creative error for details.'
    : null;

  if (hasFailure) {
    try {
      await pauseCampaign(token, campaignId);
    } catch (err) {
      throw stepError('pause campaign after partial failure', err);
    }
  }

  const { error: finalizeErr } = await service
    .from('afs_topics')
    .update({ status: finalStatus, error: finalizeError, updated_at: new Date().toISOString() })
    .eq('id', topicId);
  if (finalizeErr) {
    // The campaign is already correctly paused/left running on Facebook at this point — surface
    // the persist failure but do not attempt any further FB call.
    throw new Error(
      `Campaign ${campaignId} is now ${hasFailure ? 'PAUSED' : targetStatus}, but persisting topic status "${finalStatus}" failed: ${finalizeErr.message}`,
    );
  }

  const result: AfsPublishResult = {
    topic_id: topicId,
    status: finalStatus,
    campaign_id: campaignId,
    created_ads: creatives.filter((c) => c.fb_ad_id).length,
    failed_ads: creatives.filter((c) => c.error).length,
    error: finalizeError ?? undefined,
  };
  return { done: true, result };
}
