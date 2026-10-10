/**
 * POST /api/page-scheduler/batches/{batchId}/push  (owner only)
 *   One bounded step: expire/park, claim <=10 queued rows, push (concurrency 5).
 *   200 {pushed, failed, requeued, waiting, remaining_queued, done, backoff_ms?, halt?, stuck[]}
 *   409 when the batch is not `ready` (uploads not finalized).
 */

import { NextRequest } from 'next/server';
import { errorResponse } from '@/lib/utils';
import { getPsContext, psErrorResponse } from '@/lib/page-scheduler/access';
import { loadBatch } from '@/lib/page-scheduler/batch-queries';
import { pushStep } from '@/lib/page-scheduler/push-step';

export const maxDuration = 60;

type Params = { params: Promise<{ batchId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const ctx = await getPsContext();
  if (ctx instanceof Response) return ctx;
  const { batchId } = await params;
  const batch = await loadBatch(ctx, batchId, true);
  if (batch instanceof Response) return batch;
  if (batch.status !== 'ready') return errorResponse('Batch is not ready — finish the image upload first', 409);
  try {
    return Response.json(await pushStep(ctx.userId, batch.id));
  } catch (err) {
    return psErrorResponse(err);
  }
}
