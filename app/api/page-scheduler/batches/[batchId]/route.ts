/**
 * GET    /api/page-scheduler/batches/{batchId}?status=&page_id=&offset=
 *          -> { batch, posts[<=200, with thumb_url], total, counts, pages, owner_email, is_owner }
 *          Any visible user (staff own, leader team, admin all).
 * DELETE /api/page-scheduler/batches/{batchId}  (owner only)
 *          409 if any row is scheduled|published|pushing.
 */

import { NextRequest } from 'next/server';
import { errorResponse } from '@/lib/utils';
import { getPsContext, ownerLabels, psErrorResponse } from '@/lib/page-scheduler/access';
import { deleteBatch, getBatchDetail, loadBatch } from '@/lib/page-scheduler/batch-queries';

type Params = { params: Promise<{ batchId: string }> };
const STATUSES = ['draft', 'queued', 'waiting', 'pushing', 'scheduled', 'published', 'failed', 'cancelled'];

export async function GET(request: NextRequest, { params }: Params) {
  const ctx = await getPsContext();
  if (ctx instanceof Response) return ctx;
  const { batchId } = await params;
  const batch = await loadBatch(ctx, batchId, false);
  if (batch instanceof Response) return batch;

  const sp = request.nextUrl.searchParams;
  const status = sp.get('status');
  if (status && !STATUSES.includes(status)) return errorResponse('Invalid status filter', 400);
  const pageId = sp.get('page_id');
  if (pageId && !/^\d+$/.test(pageId)) return errorResponse('Invalid page_id', 400);
  const offset = Math.max(0, Number.parseInt(sp.get('offset') ?? '0', 10) || 0);

  try {
    const detail = await getBatchDetail(batch, status, pageId, offset);
    const labels = await ownerLabels(ctx.visibleUserIds);
    return Response.json({ batch, ...detail, owner_email: labels[batch.user_id] ?? null, is_owner: batch.user_id === ctx.userId });
  } catch (err) {
    return psErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await getPsContext();
  if (ctx instanceof Response) return ctx;
  const { batchId } = await params;
  const batch = await loadBatch(ctx, batchId, true);
  if (batch instanceof Response) return batch;
  try {
    return await deleteBatch(batch);
  } catch (err) {
    return psErrorResponse(err);
  }
}
