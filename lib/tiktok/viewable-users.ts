/**
 * Staff-picker data for the TikTok dashboard: other users the requester may view
 * (getVisibleUserIds scope) who actually have a TikTok connection. UX list only —
 * every `viewAs` request is re-authorized server-side. Never selects token columns.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { getVisibleUserIds } from '@/lib/auth-guards';
import { listConnectedUserIds } from './tiktok-connection';
import type { TiktokAdvertiserAccount, TiktokStaffMember, UserRole } from '@/lib/types';

export async function loadTiktokStaffList(userId: string, role: UserRole | null): Promise<TiktokStaffMember[]> {
  if (role !== 'leader' && role !== 'admin') return [];
  try {
    const visible = (await getVisibleUserIds(userId, role)).filter((id) => id !== userId);
    const connected = await listConnectedUserIds(visible);
    if (connected.length === 0) return [];

    const service = createServiceClient();
    const [accountsRes, usersRes] = await Promise.all([
      service
        .from('tiktok_ad_accounts')
        .select('user_id,advertiser_id,name,currency,is_selected')
        .in('user_id', connected)
        .eq('is_selected', true),
      service.auth.admin.listUsers({ perPage: 200 }),
    ]);
    if (accountsRes.error) throw new Error(accountsRes.error.message);
    if (usersRes.error) throw new Error(usersRes.error.message);

    const emailMap = new Map(usersRes.data.users.map((u) => [u.id, u.email ?? u.id]));
    const byUser = new Map<string, TiktokAdvertiserAccount[]>();
    for (const row of accountsRes.data ?? []) {
      const uid = row.user_id as string;
      const list = byUser.get(uid) ?? [];
      list.push({
        advertiser_id: row.advertiser_id as string,
        name: row.name as string,
        currency: (row.currency as string) ?? 'USD',
        is_selected: true,
      });
      byUser.set(uid, list);
    }

    return connected
      .map((id) => ({ id, email: emailMap.get(id) ?? id, accounts: byUser.get(id) ?? [] }))
      .sort((a, b) => a.email.localeCompare(b.email));
  } catch (err) {
    console.error('loadTiktokStaffList failed:', err);
    return [];
  }
}
