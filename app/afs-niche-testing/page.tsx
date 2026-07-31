import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUserRole } from '@/lib/auth-guards';
import AfsHub from './components/afs-hub';

export default async function AfsNicheTestingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const role = (await getUserRole(user.id)) ?? 'staff';
  if (role !== 'admin' && role !== 'leader') redirect('/tools'); // staff have no access to this tool

  return <AfsHub userEmail={user.email ?? ''} role={role} />;
}
