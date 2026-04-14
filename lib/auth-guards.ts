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
