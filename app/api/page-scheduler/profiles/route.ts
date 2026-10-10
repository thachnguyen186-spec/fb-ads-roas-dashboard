/**
 * GET  /api/page-scheduler/profiles -> caller's OWN FB profiles (+ pages_count). Never returns tokens.
 * POST /api/page-scheduler/profiles { token } -> validate, store encrypted, sync Pages.
 * Any authenticated role. Token travels in the POST body only and is never logged.
 */

import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { looksLikeFbAccessToken } from '@/lib/facebook/fb-client';
import { getPsContext, psErrorResponse } from '@/lib/page-scheduler/access';
import { addProfile, PROFILE_PUBLIC_COLUMNS } from '@/lib/page-scheduler/fb-profiles';

export async function GET() {
  const ctx = await getPsContext();
  if (ctx instanceof Response) return ctx;

  const service = createServiceClient();
  const [{ data: profiles, error }, { data: pages }] = await Promise.all([
    service.from('ps_fb_profiles').select(PROFILE_PUBLIC_COLUMNS).eq('user_id', ctx.userId).order('created_at'),
    service.from('ps_pages').select('profile_id').eq('user_id', ctx.userId).eq('is_active', true),
  ]);
  if (error) return errorResponse(error.message, 500);

  const counts: Record<string, number> = {};
  for (const p of (pages ?? []) as { profile_id: string }[]) counts[p.profile_id] = (counts[p.profile_id] ?? 0) + 1;
  const list = ((profiles ?? []) as unknown as { id: string }[]).map((p) => ({ ...p, pages_count: counts[p.id] ?? 0 }));
  return Response.json({ profiles: list });
}

export async function POST(request: NextRequest) {
  const ctx = await getPsContext();
  if (ctx instanceof Response) return ctx;

  let body: { token?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return errorResponse('Invalid JSON body', 400);
    body = parsed as { token?: unknown };
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!looksLikeFbAccessToken(token)) {
    return errorResponse('That does not look like a valid Facebook access token (expected EA…).', 400);
  }

  try {
    return Response.json(await addProfile(ctx.userId, token));
  } catch (err) {
    return psErrorResponse(err);
  }
}
