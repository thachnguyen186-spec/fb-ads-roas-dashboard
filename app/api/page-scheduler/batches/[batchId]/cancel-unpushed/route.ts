/**
 * POST /api/page-scheduler/batches/{batchId}/cancel-unpushed  (owner only)
 *   Cancels all draft|queued|waiting rows locally. 200 {cancelled}.
 */

import { NextRequest } from 'next/server';
import { getPsContext, psErrorResponse } from '@/lib/page-scheduler/access';
import { cancelUnpushed, loadBatch } from '@/lib/page-scheduler/batch-queries';

type Params = { params: Promise<{ batchId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const ctx = await getPsContext();
  if (ctx instanceof Response) return ctx;
  const { batchId } = await params;
  const batch = await loadBatch(ctx, batchId, true);
  if (batch instanceof Response) return batch;
  try {
    return await cancelUnpushed(batch);
  } catch (err) {
    return psErrorResponse(err);
  }
}
