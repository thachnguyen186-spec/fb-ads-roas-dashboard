/**
 * Per-topic generation pipeline: atomic status guard → delete previous creatives → two OpenAI
 * calls → validate → insert 5 `afs_creatives` rows → submit each to Kie. One topic per call.
 */
import { createServiceClient } from '@/lib/supabase/server';
import { generateTopicContent } from '@/lib/ai/afs-content';
import { fillTemplate } from '@/lib/ai/image-prompt-templates';
import { createTask } from '@/lib/kie/kie-client';
import type { AfsStyleKey, AfsTopic } from '@/lib/types';

const STYLE_KEYS: AfsStyleKey[] = ['notes_app', 'retro_pixel', 'editorial', 'craft_paper', 'bold_type'];
const CLAIMABLE_STATUSES = ['draft', 'failed', 'ready', 'partial_failed'];

export class TopicNotFoundError extends Error {
  constructor() {
    super('Topic not found');
  }
}

export class TopicNotClaimableError extends Error {
  constructor(alreadyPublished: boolean) {
    super(
      alreadyPublished
        ? 'This topic has already been published — regeneration is disabled to avoid orphaning its live campaign.'
        : 'This topic is already generating.',
    );
  }
}

async function claimTopic(userId: string, topicId: string): Promise<AfsTopic> {
  const service = createServiceClient();

  const { data: existing } = await service
    .from('afs_topics')
    .select('*')
    .eq('id', topicId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!existing) throw new TopicNotFoundError();

  const { data: claimed, error } = await service
    .from('afs_topics')
    .update({ status: 'generating', error: null, updated_at: new Date().toISOString() })
    .eq('id', topicId)
    .eq('user_id', userId)
    .in('status', CLAIMABLE_STATUSES)
    .is('fb_campaign_id', null)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Failed to claim topic: ${error.message}`);
  if (!claimed) throw new TopicNotClaimableError(!!(existing as AfsTopic).fb_campaign_id);

  return claimed as AfsTopic;
}

async function markFailed(topicId: string, message: string): Promise<void> {
  const service = createServiceClient();
  await service
    .from('afs_topics')
    .update({ status: 'failed', error: message, updated_at: new Date().toISOString() })
    .eq('id', topicId);
}

/** Runs the full pipeline for one topic. Throws TopicNotFoundError / TopicNotClaimableError on guard rejection. */
export async function generateTopic(userId: string, topicId: string): Promise<void> {
  const topic = await claimTopic(userId, topicId);
  const service = createServiceClient();

  try {
    await service.from('afs_creatives').delete().eq('topic_id', topicId);

    const content = await generateTopicContent(topic.topic_text);

    const creativeRows = STYLE_KEYS.map((styleKey) => {
      const fill = content.styles[styleKey];
      return {
        topic_id: topicId,
        user_id: userId,
        style_key: styleKey,
        image_headline: fill.headline,
        image_prompt: fillTemplate(styleKey, fill),
        status: 'pending' as const,
      };
    });

    const { data: inserted, error: insertError } = await service
      .from('afs_creatives')
      .insert(creativeRows)
      .select('id, style_key');
    if (insertError || !inserted) {
      throw new Error(`Failed to create creatives: ${insertError?.message ?? 'unknown error'}`);
    }

    await service
      .from('afs_topics')
      .update({
        primary_text: content.copy.primary_text,
        ad_headline: content.copy.ad_headline,
        countries: content.copy.countries,
        updated_at: new Date().toISOString(),
      })
      .eq('id', topicId);

    const insertedRows = inserted as { id: string; style_key: AfsStyleKey }[];
    const submissions = await Promise.allSettled(
      insertedRows.map(async (row) => {
        const promptRow = creativeRows.find((c) => c.style_key === row.style_key);
        const taskId = await createTask(promptRow!.image_prompt);
        await service
          .from('afs_creatives')
          .update({ kie_task_id: taskId, status: 'submitted', submitted_at: new Date().toISOString() })
          .eq('id', row.id);
      }),
    );

    let failedCount = 0;
    for (let i = 0; i < submissions.length; i++) {
      const result = submissions[i];
      if (result.status === 'rejected') {
        failedCount += 1;
        const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
        await service.from('afs_creatives').update({ status: 'failed', error: message }).eq('id', insertedRows[i].id);
      }
    }

    const finalStatus = failedCount === insertedRows.length ? 'failed' : failedCount > 0 ? 'partial_failed' : 'generating';
    await service
      .from('afs_topics')
      .update({
        status: finalStatus,
        error: failedCount ? `${failedCount}/${insertedRows.length} images failed to submit to Kie` : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', topicId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(topicId, message);
    throw err;
  }
}
