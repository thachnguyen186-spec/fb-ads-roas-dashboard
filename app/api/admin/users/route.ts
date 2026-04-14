/**
 * GET  /api/admin/users  → list all users with role (admin only)
 * POST /api/admin/users  → invite/create a new user (admin only)
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

  // Get all auth users + their profile roles in parallel
  const [usersRes, profilesRes] = await Promise.all([
    service.auth.admin.listUsers({ perPage: 200 }),
    service.from('profiles').select('id, role'),
  ]);

  if (usersRes.error) return errorResponse(usersRes.error.message, 500);

  const roleMap = new Map(
    (profilesRes.data ?? []).map((p) => [p.id, p.role as string]),
  );

  const users = usersRes.data.users.map((u) => ({
    id: u.id,
    email: u.email ?? '',
    role: roleMap.get(u.id) ?? 'staff',
    created_at: u.created_at,
  }));

  return Response.json({ users });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin']);
  if (denied) return denied;

  let body: { email?: string; role?: string };
  try { body = await request.json(); } catch { return errorResponse('Invalid JSON', 400); }

  if (!body.email) return errorResponse('email required', 400);
  const role = body.role ?? 'staff';
  if (!['admin', 'leader', 'staff'].includes(role)) return errorResponse('Invalid role', 400);

  const service = createServiceClient();

  // Create user with email confirmation bypassed (internal app, admin manages accounts)
  const { data, error } = await service.auth.admin.createUser({
    email: body.email,
    email_confirm: true,
    user_metadata: {},
  });

  if (error) return errorResponse(error.message, 500);

  // Set role on the auto-created profile
  await service.from('profiles').update({ role }).eq('id', data.user.id);

  return Response.json({ user: { id: data.user.id, email: data.user.email, role } }, { status: 201 });
}
