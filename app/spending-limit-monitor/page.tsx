import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import SpendingLimitHub from './components/spending-limit-hub';

export default async function SpendingLimitMonitorPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return <SpendingLimitHub userEmail={user.email ?? ''} />;
}
