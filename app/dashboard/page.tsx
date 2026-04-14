import { redirect } from 'next/navigation';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import CampaignHub from './components/campaign-hub';
import type { FbAdAccount } from '@/lib/types';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const service = createServiceClient();
  const [profileRes, accountsRes] = await Promise.all([
    service.from('profiles').select('fb_access_token').eq('id', user.id).single(),
    service
      .from('fb_ad_accounts')
      .select('account_id,name,is_selected,account_status')
      .eq('user_id', user.id)
      .eq('is_selected', true),
  ]);

  const hasToken = !!(profileRes.data as { fb_access_token?: string | null } | null)?.fb_access_token;
  const selectedAccounts = (accountsRes.data ?? []) as FbAdAccount[];

  return <CampaignHub hasToken={hasToken} selectedAccounts={selectedAccounts} />;
}
