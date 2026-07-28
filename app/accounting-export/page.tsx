import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUserRole } from '@/lib/auth-guards';
import AccountingExportHub from './components/accounting-export-hub';

export default async function AccountingExportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const role = (await getUserRole(user.id)) ?? 'staff';
  if (role !== 'admin' && role !== 'leader') redirect('/tools'); // staff have no access to this tool

  return <AccountingExportHub userEmail={user.email ?? ''} role={role} />;
}
