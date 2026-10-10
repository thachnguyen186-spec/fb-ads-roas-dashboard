/**
 * GET  /api/page-scheduler/batches?owner=all|me|<uuid>
 *        -> { batches: [{...batch, counts: {status: n}, owner_email, is_owner}], owners }
 *        Visibility via resolveOwnerFilter (staff own, leader team, admin all). Latest 50.
 * POST /api/page-scheduler/batches { file_name, source_type, rows[], files[], extra_columns[] }
 *        Creates a batch for the CALLER only. 400 {error, issues} on any row error (nothing stored).
 *        200 {batch_id, batch_status, row_count, uploads:[{name,path,token}], issues(warnings)}.
 */

import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { getPsContext, ownerLabels, psErrorResponse, resolveOwnerFilter } from '@/lib/page-scheduler/access';
import { createBatch, parseBatchPayload } from '@/lib/page-scheduler/batch-create';

/** POST signs up to 1000 upload URLs; give it the full function budget. */
export const maxDuration = 60;

const BATCH_LIMIT = 50;
const PAGE = 1000;
const MAX_COUNT_PAGES = 30;

export async function GET(request: NextRequest) {
  const ctx = await getPsContext();
  if (ctx instanceof Response) return ctx;
  const ids = resolveOwnerFilter(ctx, request.nextUrl.searchParams.get('owner'));
  if (ids instanceof Response) return ids;

  const service = createServiceClient();
  const { data, error } = await service
    .from('ps_batches')
    .select('id, user_id, file_name, source_type, status, row_count, created_at, updated_at')
    .in('user_id', ids)
    .order('created_at', { ascending: false })
    .limit(BATCH_LIMIT);
  if (error) return errorResponse(error.message, 500);
  const batches = (data ?? []) as { id: string; user_id: string }[];

  const counts = new Map<string, Record<string, number>>();
  if (batches.length) {
    const batchIds = batches.map((b) => b.id);
    for (let p = 0; p < MAX_COUNT_PAGES; p++) {
      const { data: rows, error: cErr } = await service
        .from('ps_posts').select('batch_id, status').in('batch_id', batchIds)
        .order('id').range(p * PAGE, p * PAGE + PAGE - 1);
      if (cErr) return errorResponse(cErr.message, 500);
      for (const r of (rows ?? []) as { batch_id: string; status: string }[]) {
        const c = counts.get(r.batch_id) ?? {};
        c[r.status] = (c[r.status] ?? 0) + 1;
        counts.set(r.batch_id, c);
      }
      if ((rows?.length ?? 0) < PAGE) break;
    }
  }

  const labels = await ownerLabels(ctx.visibleUserIds);
  return Response.json({
    batches: batches.map((b) => ({
      ...b, counts: counts.get(b.id) ?? {}, owner_email: labels[b.user_id] ?? null, is_owner: b.user_id === ctx.userId,
    })),
    owners: labels,
  });
}

export async function POST(request: NextRequest) {
  const ctx = await getPsContext();
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  const payload = parseBatchPayload(body);
  if (typeof payload === 'string') return errorResponse(payload, 400);

  try {
    const result = await createBatch(ctx.userId, payload);
    if (!result.ok) return Response.json({ error: result.error, issues: result.issues }, { status: result.status });
    return Response.json(result);
  } catch (err) {
    return psErrorResponse(err);
  }
}
