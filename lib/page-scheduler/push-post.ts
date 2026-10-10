/**
 * Executes one Page post push against Graph (v26). Returns FB ids or throws (FbApiError for
 * Graph failures). The page token is only held inside this call and never logged.
 */

import { PAGE_SCHEDULER_FB_API_BASE, fbPostForm, fbPostMultipart } from '@/lib/facebook/fb-client';
import { PsUserError } from './fb-profiles';
import { downloadMedia } from './media-storage';
import { buildPushRequest, parsePushResponse, type PushablePost } from './push-payload';

export async function pushPost(
  post: PushablePost & { user_id: string }, token: string,
): Promise<{ fbPostId: string | null; fbPhotoId: string | null }> {
  const req = buildPushRequest(post);
  let res: unknown;
  if (req.kind === 'photo-upload') {
    // Defense in depth: the service client can read any object, so only the owner's prefix is allowed.
    const path = req.uploadPath ?? '';
    if (!path.startsWith(`ps/${post.user_id}/`) || path.includes('..')) throw new PsUserError('Invalid image storage path');
    const media = await downloadMedia(req.uploadPath as string);
    const blob = new Blob([media.bytes as BlobPart], { type: media.contentType });
    res = await fbPostMultipart(req.path, { source: blob }, req.fields, token, PAGE_SCHEDULER_FB_API_BASE);
  } else {
    res = await fbPostForm(req.path, req.fields, token, PAGE_SCHEDULER_FB_API_BASE);
  }
  return parsePushResponse(req.kind, res);
}
