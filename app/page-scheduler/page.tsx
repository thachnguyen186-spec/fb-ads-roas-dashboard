import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUserRole } from '@/lib/auth-guards';
import PageSchedulerHub from './components/page-scheduler-hub';

// Open to every authenticated role; row visibility is enforced by the API (getVisibleUserIds).
export default async function PageSchedulerPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const role = (await getUserRole(user.id)) ?? 'staff';
  return <PageSchedulerHub userEmail={user.email ?? ''} role={role} />;
}
