/**
 * POST /api/page-scheduler/batches/{batchId}/finalize (owner only, idempotent)
 *   Verifies all uploaded images exist in Storage, then draft -> queued/waiting, batch -> ready.
 *   200 {already, queued, waiting} | 409 {error, missing[], invalid[]} (client may re-upload + retry)
 */

import { NextRequest } from 'next/server';
import { errorResponse } from '@/lib/utils';
import { getPsContext, psErrorResponse } from '@/lib/page-scheduler/access';
import { finalizeBatch } from '@/lib/page-scheduler/batch-finalize';

type Params = { params: Promise<{ batchId: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_req: NextRequest, { params }: Params) {
  const ctx = await getPsContext();
  if (ctx instanceof Response) return ctx;
  const { batchId } = await params;
  if (!UUID_RE.test(batchId)) return errorResponse('Invalid batch id', 400);

  try {
    const result = await finalizeBatch(ctx.userId, batchId, ctx.visibleUserIds);
    if (!result.ok) {
      const { status, ...body } = result;
      return Response.json(body, { status });
    }
    return Response.json(result);
  } catch (err) {
    return psErrorResponse(err);
  }
}
