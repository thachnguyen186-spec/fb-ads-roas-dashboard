/**
 * Pure builder for the Graph call that schedules one Page post (no I/O, unit-testable).
 * Always sends published=false + scheduled_publish_time (unix seconds) so FB holds the post.
 */

import type { PsPost } from './types';

export type PushablePost = Pick<PsPost, 'id' | 'page_id' | 'message' | 'scheduled_at' | 'image_kind' | 'image_ref' | 'countries'>;

export interface PushRequest {
  /** Graph path, e.g. /123/feed or /123/photos. */
  path: string;
  /** Form fields (all strings). */
  fields: Record<string, string>;
  kind: 'feed' | 'photo-url' | 'photo-upload';
  /** Storage path to download and send as multipart `source` (photo-upload only). */
  uploadPath?: string;
}

export function buildPushRequest(post: PushablePost): PushRequest {
  const ms = Date.parse(post.scheduled_at);
  if (Number.isNaN(ms)) throw new Error(`Invalid scheduled_at "${post.scheduled_at}"`);
  const fields: Record<string, string> = {
    published: 'false',
    scheduled_publish_time: String(Math.floor(ms / 1000)),
  };
  if (post.countries.length > 0) {
    fields.targeting = JSON.stringify({ geo_locations: { countries: post.countries } });
  }

  if (post.image_kind === 'none') {
    if (!post.message.trim()) throw new Error('Post has neither message nor image');
    fields.message = post.message;
    return { path: `/${post.page_id}/feed`, fields, kind: 'feed' };
  }

  if (!post.image_ref) throw new Error('Post image reference is missing');
  if (post.message) fields.caption = post.message;
  if (post.image_kind === 'url') {
    fields.url = post.image_ref;
    return { path: `/${post.page_id}/photos`, fields, kind: 'photo-url' };
  }
  return { path: `/${post.page_id}/photos`, fields, kind: 'photo-upload', uploadPath: post.image_ref };
}

/**
 * Extracts ids from a feed/photos response. A photo response without `post_id` yields
 * fbPostId=null: the photo exists but the post is unknown, so the caller must treat it as uncertain.
 */
export function parsePushResponse(kind: PushRequest['kind'], res: unknown): { fbPostId: string | null; fbPhotoId: string | null } {
  const r = (res ?? {}) as { id?: unknown; post_id?: unknown };
  const id = typeof r.id === 'string' ? r.id : null;
  const postId = typeof r.post_id === 'string' ? r.post_id : null;
  if (kind === 'feed') {
    if (!id) throw new Error('Facebook returned no post id');
    return { fbPostId: id, fbPhotoId: null };
  }
  if (!postId && !id) throw new Error('Facebook returned no post id for the photo');
  return { fbPostId: postId, fbPhotoId: id };
}
