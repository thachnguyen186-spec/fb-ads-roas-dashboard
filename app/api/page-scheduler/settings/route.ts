/**
 * GET /api/page-scheduler/settings -> { default_countries } (caller's own; preset when unset)
 * PUT /api/page-scheduler/settings { default_countries: string[] } -> 1-25 ISO2 codes
 * Own-only for every role.
 */

import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { getPsContext } from '@/lib/page-scheduler/access';
import { TIER1_COUNTRIES, parseCountryList } from '@/lib/page-scheduler/country-codes';

export async function GET() {
  const ctx = await getPsContext();
  if (ctx instanceof Response) return ctx;

  const service = createServiceClient();
  const { data, error } = await service
    .from('ps_settings')
    .select('default_countries')
    .eq('user_id', ctx.userId)
    .maybeSingle();
  if (error) return errorResponse(error.message, 500);

  const row = data as { default_countries: string[] } | null;
  return Response.json({ default_countries: row?.default_countries ?? [...TIER1_COUNTRIES] });
}

export async function PUT(request: NextRequest) {
  const ctx = await getPsContext();
  if (ctx instanceof Response) return ctx;

  let body: { default_countries?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return errorResponse('Invalid JSON body', 400);
    body = parsed as { default_countries?: unknown };
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  const parsed = parseCountryList(body.default_countries);
  if (!parsed.ok) return errorResponse(parsed.error, 400);

  const service = createServiceClient();
  const { error } = await service.from('ps_settings').upsert({
    user_id: ctx.userId,
    default_countries: parsed.countries,
    updated_at: new Date().toISOString(),
  });
  if (error) return errorResponse(error.message, 500);
  return Response.json({ default_countries: parsed.countries });
}
