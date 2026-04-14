/**
 * /admin — User management dashboard (admin only)
 * Server component: auth + role check, data fetch, then renders client tabs.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getUserRole } from '@/lib/auth-guards';
import type { ManagedUser, UserRole } from '@/lib/types';
import UserTable from './components/user-table';
import TeamManager from './components/team-manager';

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const role = await getUserRole(user.id);
  if (role !== 'admin') redirect('/dashboard');

  const service = createServiceClient();

  const [usersRes, profilesRes, teamRes] = await Promise.all([
    service.auth.admin.listUsers({ perPage: 200 }),
    service.from('profiles').select('id, role'),
    service.from('team_members').select('leader_id, staff_id'),
  ]);

  const roleMap = new Map(
    (profilesRes.data ?? []).map((p) => [p.id, p.role as UserRole]),
  );

  const users: ManagedUser[] = (usersRes.data?.users ?? []).map((u) => ({
    id: u.id,
    email: u.email ?? '',
    role: roleMap.get(u.id) ?? 'staff',
    created_at: u.created_at,
  }));

  const assignments = (teamRes.data ?? []) as { leader_id: string; staff_id: string }[];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">← Dashboard</Link>
          <span className="text-sm font-semibold text-gray-900">User Management</span>
        </div>
        <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">Admin</span>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-10">
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-4">Users</h2>
          <UserTable initialUsers={users} />
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-4">Team assignments</h2>
          <TeamManager users={users} initialAssignments={assignments} />
        </section>
      </main>
    </div>
  );
}
