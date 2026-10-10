/**
 * Page Scheduler access helpers. Visibility mirrors the FB dashboard (staff own, leader team,
 * admin all via getVisibleUserIds); only the OWNER of a row may mutate it.
 * Helpers return a Response on denial so routes can `if (x instanceof Response) return x`.
 */

import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getUserRole, getVisibleUserIds } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';
import { FbApiError } from '@/lib/facebook/fb-client';
import type { UserRole } from '@/lib/types';

export interface PsContext {
  userId: string;
  email: string;
  role: UserRole;
  visibleUserIds: string[];
}

/** Authenticates the caller (any role) and resolves their visibility set. 401 when logged out. */
export async function getPsContext(): Promise<PsContext | Response> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return errorResponse('Unauthorized', 401);
  const role = (await getUserRole(user.id)) ?? 'staff';
  try {
    const visibleUserIds = await getVisibleUserIds(user.id, role);
    return { userId: user.id, email: user.email ?? '', role, visibleUserIds };
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Failed to resolve visibility', 500);
  }
}

/**
 * `owner` query param -> user ids to read. absent/'all' = every visible user; 'me' = self;
 * a uuid must be inside the visible set, otherwise 403.
 */
export function resolveOwnerFilter(ctx: PsContext, ownerParam: string | null): string[] | Response {
  if (!ownerParam || ownerParam === 'all') return ctx.visibleUserIds;
  if (ownerParam === 'me') return [ctx.userId];
  if (!ctx.visibleUserIds.includes(ownerParam)) return errorResponse('Forbidden — user not visible to you', 403);
  return [ownerParam];
}

/** Mutation guard: only the row owner passes. Leaders/admins are read-only on rows they do not own. */
export function assertOwner(ctx: PsContext, row: { user_id: string }): Response | null {
  return row.user_id === ctx.userId ? null : errorResponse('Forbidden — only the owner can modify this', 403);
}

/** user_id -> email map, only when more than one user is visible (otherwise empty). */
export async function ownerLabels(ids: string[]): Promise<Record<string, string>> {
  if (ids.length <= 1) return {};
  const service = createServiceClient();
  const { data, error } = await service.auth.admin.listUsers({ perPage: 200 });
  if (error) return {};
  const wanted = new Set(ids);
  const out: Record<string, string> = {};
  for (const u of data?.users ?? []) if (wanted.has(u.id)) out[u.id] = u.email ?? u.id;
  return out;
}

/** Maps a thrown error to a response: token/FB problems are the caller's 400, the rest a 500. */
export function psErrorResponse(err: unknown): Response {
  const message = err instanceof Error ? err.message : 'Unexpected error';
  const isUserError = err instanceof FbApiError || (err instanceof Error && err.name === 'PsUserError');
  return errorResponse(message, isUserError ? 400 : 500);
}
