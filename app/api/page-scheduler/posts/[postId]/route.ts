/**
 * PATCH  /api/page-scheduler/posts/{postId} { message?, scheduled_at?, countries? }  (owner only)
 *          queued|waiting|failed rows only. 400 validation, 409 wrong state.
 * DELETE /api/page-scheduler/posts/{postId}  (owner only) cancel.
 *          unpushed -> local; scheduled -> Graph DELETE, 409 {error, link} if FB refuses.
 */

import { NextRequest } from 'next/server';
import { errorResponse } from '@/lib/utils';
import { getPsContext, psErrorResponse } from '@/lib/page-scheduler/access';
import { actionResponse, cancelPost, editPost, loadOwnedPost, type EditInput } from '@/lib/page-scheduler/post-actions';

type Params = { params: Promise<{ postId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const ctx = await getPsContext();
  if (ctx instanceof Response) return ctx;
  const { postId } = await params;
  const post = await loadOwnedPost(ctx, postId);
  if (post instanceof Response) return post;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return errorResponse('Body must be an object', 400);
  const { message, scheduled_at, countries } = body as EditInput;
  try {
    return actionResponse(await editPost(post, { message, scheduled_at, countries }));
  } catch (err) {
    return psErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await getPsContext();
  if (ctx instanceof Response) return ctx;
  const { postId } = await params;
  const post = await loadOwnedPost(ctx, postId);
  if (post instanceof Response) return post;
  try {
    return actionResponse(await cancelPost(post));
  } catch (err) {
    return psErrorResponse(err);
  }
}
