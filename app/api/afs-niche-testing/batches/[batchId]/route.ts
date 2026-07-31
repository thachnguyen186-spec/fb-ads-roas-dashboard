/**
 * GET /api/afs-niche-testing/batches/{batchId}
 * Reconciles all 'submitted' creative rows for this batch (sole completion path — no webhook,
 * see Phase 04), then returns the batch + its topics + creatives with 1h signed URLs.
 *
 * PATCH /api/afs-niche-testing/batches/{batchId}
 * Toggles `publish_active` only (whitelist of one field) — false (default) creates FB objects
 * PAUSED, true creates them ACTIVE. admin|leader only, and only for the batch's owner.
 */
import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';
import { reconcileBatch } from '@/lib/afs/reconcile';
import { signUrl } from '@/lib/afs/storage';
import type { AfsBatch, AfsCreative } from '@/lib/types';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin', 'leader']);
  if (denied) return denied;

  const { batchId } = await params;
  if (!batchId) return errorResponse('batchId required', 400);

  const { data: batch } = await supabase
    .from('afs_batches')
    .select('*')
    .eq('id', batchId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!batch) return errorResponse('Batch not found', 404);

  try {
    await reconcileBatch(batchId);
  } catch (err) {
    // Reconcile failures shouldn't block reading current state — the next poll retries.
    console.error(`reconcileBatch(${batchId}) failed:`, err instanceof Error ? err.message : err);
  }

  const { data: topics, error: topicsError } = await supabase
    .from('afs_topics')
    .select('*')
    .eq('batch_id', batchId)
    .order('position');
  if (topicsError) return errorResponse(topicsError.message, 500);

  const topicIds = ((topics ?? []) as { id: string }[]).map((t) => t.id);
  const { data: creativesRaw, error: creativesError } = topicIds.length
    ? await supabase.from('afs_creatives').select('*').in('topic_id', topicIds)
    : { data: [] as AfsCreative[], error: null };
  if (creativesError) return errorResponse(creativesError.message, 500);

  const creatives = await Promise.all(
    ((creativesRaw ?? []) as AfsCreative[]).map(async (creative) => {
      if (creative.status !== 'succeeded' || !creative.storage_path) return { ...creative, signed_url: null };
      try {
        return { ...creative, signed_url: await signUrl(creative.storage_path) };
      } catch (err) {
        return { ...creative, signed_url: null, sign_error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  return Response.json({ batch: batch as AfsBatch, topics: topics ?? [], creatives });
}

interface PatchBody {
  publish_active?: unknown;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin', 'leader']);
  if (denied) return denied;

  const { batchId } = await params;
  if (!batchId) return errorResponse('batchId required', 400);

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  if (typeof body.publish_active !== 'boolean') return errorResponse('publish_active must be a boolean', 400);

  const { data: existing, error: existingError } = await supabase
    .from('afs_batches')
    .select('id')
    .eq('id', batchId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (existingError) return errorResponse(existingError.message, 500);
  if (!existing) return errorResponse('Batch not found', 404);

  const { data: updated, error: updateError } = await supabase
    .from('afs_batches')
    .update({ publish_active: body.publish_active, updated_at: new Date().toISOString() })
    .eq('id', batchId)
    .eq('user_id', user.id)
    .select('*')
    .single();
  if (updateError || !updated) return errorResponse(updateError?.message ?? 'Failed to update batch', 500);

  return Response.json({ batch: updated as AfsBatch });
}
