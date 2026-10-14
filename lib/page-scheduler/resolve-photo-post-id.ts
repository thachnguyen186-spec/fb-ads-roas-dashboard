/**
 * Recovers the post id of a scheduled photo when Graph's /{page}/photos response omits `post_id`.
 *
 * Verified live (2026-10-14): for published=false + scheduled_publish_time photos, Graph v26
 * returned only the photo `id`, yet the post WAS scheduled — it appears in /{page}/scheduled_posts
 * with id "{page_id}_{photo_id}", which is exactly the photo's `page_story_id`. Treating that as
 * an uncertain outcome made every photo push "fail" and invited duplicate retries.
 */

import { PAGE_SCHEDULER_FB_API_BASE, fbGet } from '@/lib/facebook/fb-client';

/** Returns the scheduled post id for `photoId`, or null when Graph can't confirm it belongs to `pageId`. */
export async function resolvePhotoPostId(photoId: string, pageId: string, token: string): Promise<string | null> {
  try {
    const res = (await fbGet(`/${photoId}`, { fields: 'page_story_id' }, token, PAGE_SCHEDULER_FB_API_BASE)) as { page_story_id?: unknown };
    const storyId = typeof res?.page_story_id === 'string' ? res.page_story_id : null;
    // Only accept an id on this Page; anything else stays "uncertain" (caller fails safely).
    return storyId && storyId.startsWith(`${pageId}_`) ? storyId : null;
  } catch {
    return null;
  }
}
