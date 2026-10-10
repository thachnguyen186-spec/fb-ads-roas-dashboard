/**
 * POST   /api/page-scheduler/profiles/{profileId} -> resync that profile's Pages (owner only)
 * DELETE /api/page-scheduler/profiles/{profileId} -> remove profile + its Pages, re-sync the rest (owner only)
 */

import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { assertOwner, getPsContext, psErrorResponse, type PsContext } from '@/lib/page-scheduler/access';
import { removeProfile, resyncProfile } from '@/lib/page-scheduler/fb-profiles';

type Params = { params: Promise<{ profileId: string }> };

/** Loads the profile owner and enforces owner-only mutation. Returns an error Response or null. */
async function guardOwner(ctx: PsContext, profileId: string): Promise<Response | null> {
  const service = createServiceClient();
  const { data } = await service.from('ps_fb_profiles').select('user_id').eq('id', profileId).maybeSingle();
  const row = data as { user_id: string } | null;
  if (!row) return errorResponse('Profile not found', 404);
  return assertOwner(ctx, row);
}

export async function POST(_req: NextRequest, { params }: Params) {
  const ctx = await getPsContext();
  if (ctx instanceof Response) return ctx;
  const { profileId } = await params;

  const denied = await guardOwner(ctx, profileId);
  if (denied) return denied;
  try {
    return Response.json(await resyncProfile(ctx.userId, profileId));
  } catch (err) {
    return psErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await getPsContext();
  if (ctx instanceof Response) return ctx;
  const { profileId } = await params;

  const denied = await guardOwner(ctx, profileId);
  if (denied) return denied;
  try {
    await removeProfile(ctx.userId, profileId);
    return Response.json({ success: true });
  } catch (err) {
    return psErrorResponse(err);
  }
}
