/**
 * POST /api/afs-niche-testing/topics/{topicId}/generate
 * One topic per invocation. Cooldown 1.5s/user (module-level Map, same best-effort
 * single-instance pattern as app/api/accounting-export/route.ts:32) plus the atomic
 * status-transition guard inside generateTopic() itself, which is the load-bearing check.
 */
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';
import { generateTopic, TopicNotFoundError, TopicNotClaimableError } from '@/lib/afs/generation';

export const maxDuration = 60;

const COOLDOWN_MS = 1_500;
const lastGenerateAt = new Map<string, number>(); // per-user cooldown, module-level (single-instance best-effort)

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ topicId: string }> },
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin', 'leader']);
  if (denied) return denied;

  const now = Date.now();
  if (now - (lastGenerateAt.get(user.id) ?? 0) < COOLDOWN_MS) {
    return errorResponse('Please wait a moment before generating again', 429);
  }
  lastGenerateAt.set(user.id, now);

  const { topicId } = await params;
  if (!topicId) return errorResponse('topicId required', 400);

  try {
    await generateTopic(user.id, topicId);
  } catch (err) {
    if (err instanceof TopicNotFoundError) return errorResponse(err.message, 404);
    if (err instanceof TopicNotClaimableError) return errorResponse(err.message, 409);
    return errorResponse(err instanceof Error ? err.message : 'Generation failed', 500);
  }

  return Response.json({ success: true });
}
