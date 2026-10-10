/**
 * POST /api/page-scheduler/posts/{postId}/retry { confirm_uncertain?: boolean }  (owner only)
 *   failed (no fb_post_id) -> queued|waiting, attempts reset. 409 if time passed, or if the row
 *   was failed as "uncertain" and confirm_uncertain is not true.
 */

import { NextRequest } from 'next/server';
import { getPsContext, psErrorResponse } from '@/lib/page-scheduler/access';
import { actionResponse, loadOwnedPost, retryPost } from '@/lib/page-scheduler/post-actions';

type Params = { params: Promise<{ postId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const ctx = await getPsContext();
  if (ctx instanceof Response) return ctx;
  const { postId } = await params;
  const post = await loadOwnedPost(ctx, postId);
  if (post instanceof Response) return post;

  let confirm = false;
  try {
    const body = (await request.json()) as { confirm_uncertain?: unknown } | null;
    confirm = body?.confirm_uncertain === true;
  } catch {
    // empty body is fine
  }
  try {
    return actionResponse(await retryPost(post, confirm));
  } catch (err) {
    return psErrorResponse(err);
  }
}
