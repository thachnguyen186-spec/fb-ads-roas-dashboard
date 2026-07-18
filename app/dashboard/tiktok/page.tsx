import { redirect } from 'next/navigation';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getConnectionStatus } from '@/lib/tiktok/tiktok-connection';
import TiktokCampaignHub from './components/tiktok-campaign-hub';
import type { TiktokAdvertiserAccount } from '@/lib/types';

export default async function TiktokDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const service = createServiceClient();

  const [status, accountsRes] = await Promise.all([
    getConnectionStatus(),
    service
      .from('tiktok_advertiser_accounts')
      .select('advertiser_id,name,currency,is_selected')
      .eq('is_selected', true),
  ]);

  // Adjust tokens are org-wide env vars — same check as the FB dashboard page.
  const hasAdjustToken = !!process.env.ADJUST_API_TOKEN && !!process.env.ADJUST_ACCOUNT_ID;
  const selectedAdvertisers = (accountsRes.data ?? []) as TiktokAdvertiserAccount[];

  return (
    <TiktokCampaignHub
      hasTiktokConnection={status.connected}
      hasAdjustToken={hasAdjustToken}
      selectedAdvertisers={selectedAdvertisers}
      userEmail={user.email ?? ''}
    />
  );
}
