/**
 * GET /api/leader/staff
 * Returns the staff members assigned to the current leader,
 * including each staff member's selected FB ad accounts.
 * Accessible by leader and admin roles.
 */

import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';
import type { StaffMember, FbAdAccount } from '@/lib/types';

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['leader', 'admin']);
  if (denied) return denied;

  const service = createServiceClient();

  // Get all staff IDs assigned to this leader
  const { data: teamRows, error: teamError } = await service
    .from('team_members')
    .select('staff_id')
    .eq('leader_id', user.id);

  if (teamError) return errorResponse(teamError.message, 500);
  if (!teamRows || teamRows.length === 0) return Response.json({ staff: [] });

  const staffIds = teamRows.map((r) => r.staff_id as string);

  // Fetch auth emails + selected accounts in parallel
  const [usersRes, accountsRes] = await Promise.all([
    service.auth.admin.listUsers({ perPage: 200 }),
    service
      .from('fb_ad_accounts')
      .select('user_id, account_id, name, is_selected, account_status, currency')
      .in('user_id', staffIds)
      .eq('is_selected', true),
  ]);

  const emailMap = new Map(
    (usersRes.data?.users ?? []).map((u) => [u.id, u.email ?? '']),
  );

  const accountsByUser = new Map<string, FbAdAccount[]>();
  for (const row of accountsRes.data ?? []) {
    const uid = row.user_id as string;
    if (!accountsByUser.has(uid)) accountsByUser.set(uid, []);
    accountsByUser.get(uid)!.push({
      account_id: row.account_id,
      name: row.name,
      is_selected: row.is_selected,
      account_status: row.account_status,
      currency: row.currency ?? 'USD',
    });
  }

  const staff: StaffMember[] = staffIds.map((id) => ({
    id,
    email: emailMap.get(id) ?? id,
    accounts: accountsByUser.get(id) ?? [],
  }));

  return Response.json({ staff });
}
