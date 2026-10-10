/**
 * GET /api/page-scheduler/pages?owner=all|me|<uuid>
 * Lists Pages for users the caller may see (staff own, leader team, admin all). A forged owner
 * outside the visible set -> 403. Never returns page tokens.
 */

import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { getPsContext, ownerLabels, resolveOwnerFilter } from '@/lib/page-scheduler/access';

interface PageRow {
  id: string;
  user_id: string;
  page_id: string;
  name: string;
  category: string | null;
  picture_url: string | null;
  tasks: string[];
  is_active: boolean;
  synced_at: string | null;
  ps_fb_profiles: { fb_user_name: string; status: string } | { fb_user_name: string; status: string }[] | null;
}

export async function GET(request: NextRequest) {
  const ctx = await getPsContext();
  if (ctx instanceof Response) return ctx;

  const ids = resolveOwnerFilter(ctx, request.nextUrl.searchParams.get('owner'));
  if (ids instanceof Response) return ids;

  const service = createServiceClient();
  const { data, error } = await service
    .from('ps_pages')
    .select('id, user_id, page_id, name, category, picture_url, tasks, is_active, synced_at, ps_fb_profiles(fb_user_name, status)')
    .in('user_id', ids)
    .order('name');
  if (error) return errorResponse(error.message, 500);

  const labels = await ownerLabels(ctx.visibleUserIds);
  const pages = ((data ?? []) as unknown as PageRow[]).map(({ ps_fb_profiles, ...p }) => {
    const prof = Array.isArray(ps_fb_profiles) ? ps_fb_profiles[0] : ps_fb_profiles;
    return {
      ...p,
      profile_name: prof?.fb_user_name ?? '',
      profile_status: prof?.status ?? 'active',
      owner_email: labels[p.user_id] ?? null,
      is_owner: p.user_id === ctx.userId,
    };
  });
  return Response.json({ pages, owners: labels });
}
