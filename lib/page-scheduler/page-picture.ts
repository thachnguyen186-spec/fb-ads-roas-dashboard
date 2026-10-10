/**
 * Page profile-picture change. Image goes browser -> private Storage (signed upload) -> Facebook
 * (`POST /{page-id}/picture?picture=<10-min signed url>`), so no large body hits a route handler.
 * Owner + MANAGE task enforced server-side; page tokens never leave the server.
 */

import { fbGet, fbPostForm, PAGE_SCHEDULER_FB_API_BASE } from '@/lib/facebook/fb-client';
import { createServiceClient } from '@/lib/supabase/server';
import { classifyFbError } from './graph-errors';
import { getPageToken, markProfileInvalid, PsUserError } from './fb-profiles';
import { IMAGE_MAX_BYTES, MEDIA_BUCKET, PNG_MAX_BYTES } from './constants';

const SIGNED_URL_TTL_SECONDS = 600;
const PICTURE_EXTS = ['jpg', 'jpeg', 'png'] as const;
const PICTURE_TYPES: Record<string, (typeof PICTURE_EXTS)[number]> = { 'image/jpeg': 'jpg', 'image/png': 'png' };
const PAGE_ID_RE = /^\d{5,30}$/;

export function isValidPageId(pageId: string): boolean {
  return PAGE_ID_RE.test(pageId);
}

function avatarPrefix(userId: string, pageId: string): string {
  return `ps/${userId}/avatars/${pageId}-`;
}

interface OwnedPage {
  profile_id: string;
  tasks: string[];
  is_active: boolean;
}

/** Loads the caller's own ps_pages row and requires an active Page with the MANAGE task. */
async function loadManageablePage(userId: string, pageId: string): Promise<OwnedPage> {
  const service = createServiceClient();
  const { data } = await service
    .from('ps_pages')
    .select('profile_id, tasks, is_active')
    .eq('user_id', userId)
    .eq('page_id', pageId)
    .maybeSingle();
  const row = data as OwnedPage | null;
  if (!row) throw new PsUserError('Page not found among your connected Pages');
  if (!row.is_active) throw new PsUserError('Page is inactive — resync its profile in Settings');
  if (!row.tasks.includes('MANAGE')) {
    throw new PsUserError('This token lacks the MANAGE task on the Page — assign it Full control in Business Settings, then resync.');
  }
  return row;
}

/** Validates the file metadata and returns a server-generated path + signed upload token. */
export async function signPictureUpload(
  userId: string, pageId: string, size: number, type: string,
): Promise<{ path: string; token: string }> {
  const ext = PICTURE_TYPES[type];
  if (!ext) throw new PsUserError('Picture must be a JPEG or PNG image');
  if (!Number.isFinite(size) || size <= 0) throw new PsUserError('Invalid file size');
  if (size > IMAGE_MAX_BYTES) throw new PsUserError('Picture must be at most 4 MB');
  if (ext === 'png' && size > PNG_MAX_BYTES) throw new PsUserError('PNG pictures must be at most 1 MB — use JPEG for larger images');
  await loadManageablePage(userId, pageId);

  const path = `${avatarPrefix(userId, pageId)}${Date.now()}.${ext}`;
  const { data, error } = await createServiceClient().storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) throw new Error(`Failed to create upload URL: ${error?.message ?? 'unknown error'}`);
  return { path, token: data.token };
}

/** The signed upload URL does not enforce size/type: check the stored object's metadata before using it. */
async function verifyUploadedPicture(path: string, ext: string): Promise<void> {
  const storage = createServiceClient().storage.from(MEDIA_BUCKET);
  const slash = path.lastIndexOf('/');
  const { data, error } = await storage.list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 10 });
  if (error) throw new Error(`Failed to inspect uploaded picture: ${error.message}`);
  const obj = (data ?? []).find((o) => o.name === path.slice(slash + 1));
  const meta = obj?.metadata as { size?: number; mimetype?: string } | null | undefined;
  if (!obj || typeof meta?.size !== 'number') throw new PsUserError('Uploaded picture not found — upload it again');
  const bad = meta.size <= 0 || meta.size > IMAGE_MAX_BYTES || (ext === 'png' && meta.size > PNG_MAX_BYTES)
    || !(meta.mimetype ?? '') || !Object.keys(PICTURE_TYPES).includes(meta.mimetype as string);
  if (bad) {
    await storage.remove([path]); // rejected object: best effort cleanup
    throw new PsUserError('Uploaded picture must be a JPEG (max 4 MB) or PNG (max 1 MB)');
  }
}

/** Pushes the uploaded image to Facebook and refreshes the stored thumbnail. Returns the new URL. */
export async function applyPagePicture(userId: string, pageId: string, path: string): Promise<string> {
  const ext = path.split('.').pop() ?? '';
  const valid = path.startsWith(avatarPrefix(userId, pageId))
    && !path.includes('..')
    && (PICTURE_EXTS as readonly string[]).includes(ext)
    && !path.slice(avatarPrefix(userId, pageId).length).includes('/');
  if (!valid) throw new PsUserError('Invalid picture path');

  const page = await loadManageablePage(userId, pageId);
  const pageToken = await getPageToken(userId, pageId);
  const storage = createServiceClient().storage.from(MEDIA_BUCKET);
  await verifyUploadedPicture(path, ext);

  const { data: signed, error: signErr } = await storage.createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signErr || !signed?.signedUrl) throw new PsUserError('Uploaded picture not found — upload it again');

  try {
    await fbPostForm(`/${pageId}/picture`, { picture: signed.signedUrl }, pageToken, PAGE_SCHEDULER_FB_API_BASE);
  } catch (err) {
    if (classifyFbError(err) === 'auth') {
      await markProfileInvalid(page.profile_id, err instanceof Error ? err.message : 'Auth error');
    }
    throw err;
  } finally {
    await storage.remove([path]); // single-use object; best effort
  }

  const res = await fbGet(`/${pageId}`, { fields: 'picture{url}' }, pageToken, PAGE_SCHEDULER_FB_API_BASE) as {
    picture?: { data?: { url?: string } };
  };
  const url = res.picture?.data?.url ?? null;
  if (url) {
    await createServiceClient()
      .from('ps_pages')
      .update({ picture_url: url, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('page_id', pageId);
  }
  return url ?? '';
}
