import { redirect } from 'next/navigation';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getUserRole } from '@/lib/auth-guards';
import CampaignHub from './components/campaign-hub';
import type { FbAdAccount, StaffMember, UserRole } from '@/lib/types';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const service = createServiceClient();

  const [profileRes, accountsRes, role] = await Promise.all([
    service.from('profiles').select('fb_access_token').eq('id', user.id).single(),
    service
      .from('fb_ad_accounts')
      .select('account_id,name,is_selected,account_status,currency')
      .eq('user_id', user.id)
      .eq('is_selected', true),
    getUserRole(user.id),
  ]);

  const profile = profileRes.data as { fb_access_token?: string | null } | null;
  const hasToken = !!profile?.fb_access_token;
  // Adjust tokens are org-wide env vars — available to all users when configured on the server
  const hasAdjustToken = !!process.env.ADJUST_API_TOKEN && !!process.env.ADJUST_APP_TOKEN;
  const selectedAccounts = (accountsRes.data ?? []) as FbAdAccount[];
  const userRole = (role ?? 'staff') as UserRole;

  // For leaders/admins: load assigned staff + their selected accounts directly from DB
  let staffList: StaffMember[] = [];
  if (userRole === 'leader' || userRole === 'admin') {
    const { data: teamRows } = await service
      .from('team_members')
      .select('staff_id')
      .eq('leader_id', user.id);

    const staffIds = (teamRows ?? []).map((r) => r.staff_id as string);

    if (staffIds.length > 0) {
      const [authRes, staffAccountsRes] = await Promise.all([
        service.auth.admin.listUsers({ perPage: 200 }),
        service
          .from('fb_ad_accounts')
          .select('user_id,account_id,name,is_selected,account_status,currency')
          .in('user_id', staffIds)
          .eq('is_selected', true),
      ]);

      const emailMap = new Map(
        (authRes.data?.users ?? []).map((u) => [u.id, u.email ?? u.id]),
      );
      const accountsByUser = new Map<string, FbAdAccount[]>();
      for (const row of staffAccountsRes.data ?? []) {
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

      staffList = staffIds.map((id) => ({
        id,
        email: emailMap.get(id) ?? id,
        accounts: accountsByUser.get(id) ?? [],
      }));
    }
  }

  return (
    <CampaignHub
      hasToken={hasToken}
      hasAdjustToken={hasAdjustToken}
      selectedAccounts={selectedAccounts}
      userRole={userRole}
      staffList={staffList}
    />
  );
}
