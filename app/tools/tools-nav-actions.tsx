'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { UserRole } from '@/lib/types';

export default function ToolsNavActions({ userRole }: { userRole: UserRole }) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <div className="flex items-center gap-4">
      {userRole === 'admin' && (
        <Link href="/admin" className="text-sm text-purple-600 hover:text-purple-700 font-medium">
          Admin
        </Link>
      )}
      <Link href="/settings" className="text-sm text-slate-500 hover:text-slate-800">Settings</Link>
      <button onClick={handleSignOut} className="text-sm text-slate-500 hover:text-slate-800">Sign out</button>
    </div>
  );
}
