/**
 * Shared authorization helpers for role-gated API routes.
 * All role lookups use the service client to bypass RLS.
 */

import { createServiceClient } from './supabase/server';
import { errorResponse } from './utils';
import type { UserRole } from './types';

/** Returns the role for userId, or null if not found. */
export async function getUserRole(userId: string): Promise<UserRole | null> {
  const service = createServiceClient();
  const { data } = await service
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  return (data as { role?: UserRole } | null)?.role ?? null;
}

/**
 * Checks that userId has one of the allowed roles.
 * Returns an error Response if not authorized, or null if allowed.
 */
export async function requireRole(
  userId: string,
  allowed: UserRole[],
): Promise<Response | null> {
  const role = await getUserRole(userId);
  if (!role || !allowed.includes(role)) {
    return errorResponse('Forbidden', 403);
  }
  return null;
}

/**
 * For leader/admin viewAs: verifies the requesting user is allowed to view
 * the target user's data. Admin can view anyone; leader can only view their
 * assigned staff.
 * Returns an error Response if not authorized, or null if allowed.
 */
export async function canViewAs(
  requesterId: string,
  targetId: string,
): Promise<Response | null> {
  const requesterRole = await getUserRole(requesterId);

  if (requesterRole === 'admin') return null; // admin can view anyone

  if (requesterRole === 'leader') {
    const service = createServiceClient();
    const { data } = await service
      .from('team_members')
      .select('id')
      .eq('leader_id', requesterId)
      .eq('staff_id', targetId)
      .single();
    if (data) return null; // staff is in this leader's team
  }

  return errorResponse('Forbidden — target user not in your team', 403);
}

/**
 * Returns the set of user_ids whose FB data the requester may view.
 * admin → every user with a profile row; leader → self + assigned staff; staff → [self].
 * Used by the Accounting Export routes for role-scoped fan-out and owner-label writes.
 */
export async function getVisibleUserIds(
  userId: string,
  role: UserRole,
): Promise<string[]> {
  const service = createServiceClient();
  if (role === 'admin') {
    // Check .error explicitly (mirrors app/api/admin/users/route.ts) — never silently
    // fall back to [userId], which would shrink an org-wide export to just the admin.
    const { data, error } = await service.auth.admin.listUsers({ perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const ids = (data?.users ?? []).map((u) => u.id);
    return ids.length ? ids : [userId];
  }
  if (role === 'leader') {
    const { data } = await service
      .from('team_members')
      .select('staff_id')
      .eq('leader_id', userId);
    const staff = (data ?? []).map((r) => (r as { staff_id: string }).staff_id);
    return [userId, ...staff];
  }
  return [userId];
}
