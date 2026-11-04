import { redirect } from 'next/navigation';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getUserRole } from '@/lib/auth-guards';
import { getConnectionStatus } from '@/lib/tiktok/tiktok-connection';
import { loadTiktokStaffList } from '@/lib/tiktok/viewable-users';
import TiktokCampaignHub from './components/tiktok-campaign-hub';
import type { TiktokAdvertiserAccount } from '@/lib/types';

export default async function TiktokDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const service = createServiceClient();

  const [role, status, accountsRes] = await Promise.all([
    getUserRole(user.id),
    getConnectionStatus(user.id),
    service
      .from('tiktok_ad_accounts')
      .select('advertiser_id,name,currency,is_selected')
      .eq('user_id', user.id)
      .eq('is_selected', true),
  ]);
  const staffList = await loadTiktokStaffList(user.id, role);

  const selectedAdvertisers = (accountsRes.data ?? []) as TiktokAdvertiserAccount[];

  return (
    <TiktokCampaignHub
      hasTiktokConnection={status.connected}
      selectedAdvertisers={selectedAdvertisers}
      userRole={role ?? 'staff'}
      staffList={staffList}
      userEmail={user.email ?? ''}
    />
  );
}
