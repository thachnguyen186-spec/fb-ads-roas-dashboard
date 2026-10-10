/**
 * POST /api/page-scheduler/pages/{pageId}/picture   (owner only, Page needs the MANAGE task)
 *   {action:'sign', size, type}  -> {path, token}  (client then uploadToSignedUrl)
 *   {action:'apply', path}       -> {picture_url}  (server pushes the image to Facebook)
 */

import { NextRequest } from 'next/server';
import { errorResponse } from '@/lib/utils';
import { getPsContext, psErrorResponse } from '@/lib/page-scheduler/access';
import { applyPagePicture, isValidPageId, signPictureUpload } from '@/lib/page-scheduler/page-picture';

type Params = { params: Promise<{ pageId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const ctx = await getPsContext();
  if (ctx instanceof Response) return ctx;
  const { pageId } = await params;
  if (!isValidPageId(pageId)) return errorResponse('Invalid page id', 400);

  const body = await request.json().catch(() => null) as
    { action?: unknown; size?: unknown; type?: unknown; path?: unknown } | null;
  if (!body || typeof body.action !== 'string') return errorResponse('Invalid request body', 400);

  try {
    if (body.action === 'sign') {
      if (typeof body.size !== 'number' || typeof body.type !== 'string') return errorResponse('size and type are required', 400);
      return Response.json(await signPictureUpload(ctx.userId, pageId, body.size, body.type));
    }
    if (body.action === 'apply') {
      if (typeof body.path !== 'string') return errorResponse('path is required', 400);
      return Response.json({ picture_url: await applyPagePicture(ctx.userId, pageId, body.path) });
    }
    return errorResponse('Unknown action', 400);
  } catch (err) {
    return psErrorResponse(err);
  }
}
