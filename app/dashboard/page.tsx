import { redirect } from 'next/navigation';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import CampaignHub from './components/campaign-hub';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Check if FB credentials are configured
  const service = createServiceClient();
  const { data: profile } = await service
    .from('profiles')
    .select('fb_access_token, fb_ad_account_id')
    .eq('id', user.id)
    .single();

  const hasFbConfig = !!(
    (profile as { fb_access_token?: string | null; fb_ad_account_id?: string | null } | null)
      ?.fb_access_token &&
    (profile as { fb_access_token?: string | null; fb_ad_account_id?: string | null } | null)
      ?.fb_ad_account_id
  );

  return <CampaignHub hasFbConfig={hasFbConfig} />;
}
