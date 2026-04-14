/**
 * PATCH /api/admin/users/:userId → update user role (admin only)
 * DELETE /api/admin/users/:userId → delete user account (admin only)
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin']);
  if (denied) return denied;

  const { userId } = await params;
  if (userId === user.id) return errorResponse('Cannot change your own role', 400);

  let body: { role?: string };
  try { body = await request.json(); } catch { return errorResponse('Invalid JSON', 400); }

  const role = body.role;
  if (!role || !['admin', 'leader', 'staff'].includes(role)) {
    return errorResponse('role must be admin | leader | staff', 400);
  }

  const service = createServiceClient();
  const { error } = await service
    .from('profiles')
    .update({ role })
    .eq('id', userId);

  if (error) return errorResponse(error.message, 500);
  return Response.json({ success: true, userId, role });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin']);
  if (denied) return denied;

  const { userId } = await params;
  if (userId === user.id) return errorResponse('Cannot delete your own account', 400);

  const service = createServiceClient();
  const { error } = await service.auth.admin.deleteUser(userId);
  if (error) return errorResponse(error.message, 500);

  return Response.json({ success: true });
}
