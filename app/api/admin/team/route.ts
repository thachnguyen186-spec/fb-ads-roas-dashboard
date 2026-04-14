/**
 * GET    /api/admin/team  → list all team assignments (admin only)
 * POST   /api/admin/team  → assign staff to leader (admin only)
 * DELETE /api/admin/team  → remove staff from leader (admin only)
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin']);
  if (denied) return denied;

  const service = createServiceClient();
  const { data, error } = await service
    .from('team_members')
    .select('leader_id, staff_id, created_at');

  if (error) return errorResponse(error.message, 500);
  return Response.json({ assignments: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin']);
  if (denied) return denied;

  let body: { leaderId?: string; staffId?: string };
  try { body = await request.json(); } catch { return errorResponse('Invalid JSON', 400); }

  if (!body.leaderId || !body.staffId) return errorResponse('leaderId and staffId required', 400);
  if (body.leaderId === body.staffId) return errorResponse('Leader and staff cannot be the same user', 400);

  const service = createServiceClient();
  const { error } = await service
    .from('team_members')
    .insert({ leader_id: body.leaderId, staff_id: body.staffId });

  if (error) {
    // Unique constraint = already assigned
    if (error.code === '23505') return Response.json({ success: true });
    return errorResponse(error.message, 500);
  }
  return Response.json({ success: true }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin']);
  if (denied) return denied;

  let body: { leaderId?: string; staffId?: string };
  try { body = await request.json(); } catch { return errorResponse('Invalid JSON', 400); }

  if (!body.leaderId || !body.staffId) return errorResponse('leaderId and staffId required', 400);

  const service = createServiceClient();
  const { error } = await service
    .from('team_members')
    .delete()
    .eq('leader_id', body.leaderId)
    .eq('staff_id', body.staffId);

  if (error) return errorResponse(error.message, 500);
  return Response.json({ success: true });
}
