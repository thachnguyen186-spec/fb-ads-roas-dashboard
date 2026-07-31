/**
 * Reconcile-on-poll: the sole completion path for Kie image generation (webhook cut per Phase 04
 * red-team review). Called on every `GET /batches/{id}`. Claims 'submitted' rows atomically
 * before touching Kie, so two concurrent polls never double-fetch/double-upload the same row.
 */
import { createServiceClient } from '@/lib/supabase/server';
import { getTaskResult } from '@/lib/kie/kie-client';
import { rehostKieImage } from '@/lib/afs/storage';
import type { AfsCreative, AfsTopic } from '@/lib/types';

const RECONCILE_CAP = 10;
const TIMEOUT_MS = 15 * 60 * 1000;
// A 'pending' row normally flips to 'submitted' within seconds (right after insert, before the
// createTask call). If it's still 'pending' after this long, the generate() call that would have
// submitted it to Kie almost certainly crashed mid-flight — without this, such a row is invisible
// to the 'submitted'-only reconcile query and its topic is stuck 'generating' forever.
const PENDING_TIMEOUT_MS = 15 * 60 * 1000;

async function claimCreative(id: string, fromStatus: 'submitted' | 'pending'): Promise<AfsCreative | null> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('afs_creatives')
    .update({ status: 'reconciling', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', fromStatus)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Failed to claim creative ${id}: ${error.message}`);
  return data as AfsCreative | null;
}

async function resolvePendingCreative(creative: AfsCreative): Promise<void> {
  const service = createServiceClient();
  const createdAtMs = new Date(creative.created_at).getTime();

  if (Date.now() - createdAtMs > PENDING_TIMEOUT_MS) {
    await service
      .from('afs_creatives')
      .update({ status: 'failed', error: 'Never submitted to Kie — generation likely crashed mid-flight', updated_at: new Date().toISOString() })
      .eq('id', creative.id);
    return;
  }

  // Not stale yet — release the claim; generate() may still be legitimately mid-flight.
  await service.from('afs_creatives').update({ status: 'pending', updated_at: new Date().toISOString() }).eq('id', creative.id);
}

async function resolveCreative(creative: AfsCreative, batchId: string): Promise<void> {
  const service = createServiceClient();
  const submittedAtMs = creative.submitted_at ? new Date(creative.submitted_at).getTime() : Date.now();

  if (Date.now() - submittedAtMs > TIMEOUT_MS) {
    await service
      .from('afs_creatives')
      .update({ status: 'failed', error: 'generation timed out', updated_at: new Date().toISOString() })
      .eq('id', creative.id);
    return;
  }

  if (!creative.kie_task_id) {
    await service
      .from('afs_creatives')
      .update({ status: 'failed', error: 'missing Kie task id', updated_at: new Date().toISOString() })
      .eq('id', creative.id);
    return;
  }

  try {
    const result = await getTaskResult(creative.kie_task_id);

    if (result.state === 'success' && result.resultUrls[0]) {
      const rehosted = await rehostKieImage(
        creative.user_id, batchId, creative.topic_id, creative.id, creative.style_key, result.resultUrls[0],
      );
      await service
        .from('afs_creatives')
        .update({ status: 'succeeded', storage_path: rehosted.storage_path, error: null, updated_at: new Date().toISOString() })
        .eq('id', creative.id);
    } else if (result.state === 'fail') {
      await service
        .from('afs_creatives')
        .update({ status: 'failed', error: result.failMsg ?? 'Kie generation failed', updated_at: new Date().toISOString() })
        .eq('id', creative.id);
    } else {
      // Still in progress on Kie's side — release the claim so the next poll retries it.
      await service
        .from('afs_creatives')
        .update({ status: 'submitted', updated_at: new Date().toISOString() })
        .eq('id', creative.id);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await service
      .from('afs_creatives')
      .update({ status: 'failed', error: message, updated_at: new Date().toISOString() })
      .eq('id', creative.id);
  }
}

async function recomputeTopicStatuses(batchId: string): Promise<void> {
  const service = createServiceClient();
  const { data: topics } = await service.from('afs_topics').select('*').eq('batch_id', batchId);

  for (const topic of (topics ?? []) as AfsTopic[]) {
    if (topic.status !== 'generating' && topic.status !== 'partial_failed') continue;

    const { data: creatives } = await service.from('afs_creatives').select('status').eq('topic_id', topic.id);
    const rows = (creatives ?? []) as { status: string }[];
    const stillPending = rows.some((c) => ['pending', 'submitted', 'reconciling'].includes(c.status));
    const anySucceeded = rows.some((c) => c.status === 'succeeded');
    if (stillPending) continue;

    if (anySucceeded) {
      await service.from('afs_topics').update({ status: 'ready', updated_at: new Date().toISOString() }).eq('id', topic.id);
    } else {
      // All 5 creatives finished with none succeeding — without this the topic would stay
      // 'generating' forever, invisible to Phase 05's retry queue (which only picks up draft/failed).
      await service
        .from('afs_topics')
        .update({ status: 'failed', error: 'All 5 images failed to generate', updated_at: new Date().toISOString() })
        .eq('id', topic.id);
    }
  }
}

/** Reconciles up to RECONCILE_CAP 'submitted' rows (plus stale 'pending' ones) for this batch, then recomputes topic statuses. */
export async function reconcileBatch(batchId: string): Promise<void> {
  const service = createServiceClient();

  const { data: topicRows, error: topicsError } = await service.from('afs_topics').select('id').eq('batch_id', batchId);
  if (topicsError) throw new Error(`Failed to list topics: ${topicsError.message}`);
  const topicIds = (topicRows ?? []).map((t: { id: string }) => t.id);
  if (topicIds.length === 0) return;

  const { data, error } = await service
    .from('afs_creatives')
    .select('id')
    .eq('status', 'submitted')
    .in('topic_id', topicIds)
    .limit(RECONCILE_CAP);
  if (error) throw new Error(`Failed to list submitted creatives: ${error.message}`);

  for (const row of (data ?? []) as { id: string }[]) {
    const claimed = await claimCreative(row.id, 'submitted');
    if (!claimed) continue; // already claimed by a concurrent poll
    await resolveCreative(claimed, batchId);
  }

  const { data: pendingData, error: pendingError } = await service
    .from('afs_creatives')
    .select('id')
    .eq('status', 'pending')
    .in('topic_id', topicIds)
    .limit(RECONCILE_CAP);
  if (pendingError) throw new Error(`Failed to list pending creatives: ${pendingError.message}`);

  for (const row of (pendingData ?? []) as { id: string }[]) {
    const claimed = await claimCreative(row.id, 'pending');
    if (!claimed) continue;
    await resolvePendingCreative(claimed);
  }

  await recomputeTopicStatuses(batchId);
}
