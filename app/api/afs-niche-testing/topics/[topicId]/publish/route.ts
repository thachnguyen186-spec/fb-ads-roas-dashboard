/**
 * POST /api/afs-niche-testing/topics/[topicId]/publish
 * Advances one topic's publish state machine by exactly one step (create campaign, OR create
 * adset, OR publish one creative) and returns immediately. The client calls this repeatedly
 * until the response reports `done: true`. See lib/afs/publish-step.ts for the state machine.
 * admin|leader only, and only for topics the caller owns.
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';
import { getLaunchToken } from '@/lib/afs/launch-token';
import { publishStep, ALREADY_PUBLISHED_ERROR } from '@/lib/afs/publish-step';
import { matchesRiskKeyword, SPECIAL_CATEGORY_OVERRIDE_PHRASE } from '@/lib/afs/risk-keywords';
import type { AfsTopic } from '@/lib/types';

type Params = { params: Promise<{ topicId: string }> };

const PUBLISHABLE_STATUSES = new Set(['ready', 'partial_failed', 'publishing']);

export async function POST(request: NextRequest, { params }: Params) {
  const { topicId } = await params;

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin', 'leader']);
  if (denied) return denied;

  const service = createServiceClient();
  const { data: topicRow, error: topicErr } = await service
    .from('afs_topics')
    .select('user_id, status, fb_campaign_id, topic_text, special_ad_category')
    .eq('id', topicId)
    .maybeSingle();

  if (topicErr) return errorResponse(topicErr.message, 500);
  if (!topicRow) return errorResponse('Topic not found', 404);

  const topic = topicRow as Pick<AfsTopic, 'user_id' | 'status' | 'fb_campaign_id' | 'topic_text' | 'special_ad_category'>;
  if (topic.user_id !== user.id) return errorResponse('Forbidden — not your topic', 403);

  // [Red Team Fix] The UI disables the publish button on a keyword/category mismatch, but that's
  // only a client-side gate — re-check it here, the actual enforcement point, since a direct API
  // call would otherwise bypass it entirely despite the account-wide blast radius this protects.
  if (topic.fb_campaign_id === null && matchesRiskKeyword(topic.topic_text) && topic.special_ad_category === 'NONE') {
    let overrideConfirmation = '';
    try {
      const body = await request.json() as { override_confirmation?: unknown };
      overrideConfirmation = typeof body.override_confirmation === 'string' ? body.override_confirmation : '';
    } catch {
      // No/invalid JSON body — treat as no override, fall through to the rejection below.
    }
    if (overrideConfirmation !== SPECIAL_CATEGORY_OVERRIDE_PHRASE) {
      return errorResponse(
        `This topic looks employment/housing/credit-adjacent but special_ad_category is NONE. Select the matching category, or confirm the override in the review screen.`,
        409,
      );
    }
  }

  // [Red Team Fix] Defense-in-depth: reject before touching publishStep at all. publishStep
  // re-checks the same condition itself (it must never trust a caller), so this is belt-and-
  // suspenders, not the sole guard.
  if (topic.fb_campaign_id && topic.status === 'published') {
    return errorResponse(ALREADY_PUBLISHED_ERROR, 409);
  }

  if (!PUBLISHABLE_STATUSES.has(topic.status)) {
    return errorResponse(
      `Topic status "${topic.status}" is not publishable — must be ready, partial_failed, or publishing.`,
      409,
    );
  }

  try {
    await getLaunchToken(user.id); // fail fast with an actionable error if no token configured
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'No launch token configured', 400);
  }

  try {
    const result = await publishStep(user.id, topicId);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Publish step failed';
    return errorResponse(message, 502);
  }
}
