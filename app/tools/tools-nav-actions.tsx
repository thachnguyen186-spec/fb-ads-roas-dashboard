'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { UserRole } from '@/lib/types';

interface Props {
  userRole: UserRole;
  userEmail: string;
}

function getInitials(email: string) {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

export default function ToolsNavActions({ userRole, userEmail }: Props) {
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

      {/* User identity */}
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-xs font-semibold flex items-center justify-center select-none">
          {getInitials(userEmail)}
        </span>
        <span className="text-xs text-slate-500 hidden sm:block max-w-[140px] truncate">{userEmail}</span>
      </div>

      <Link href="/settings" className="text-sm text-slate-500 hover:text-slate-800">Settings</Link>

      {/* Separator before destructive action */}
      <span className="text-slate-200 select-none">|</span>

      <button
        onClick={handleSignOut}
        className="text-sm text-red-500 hover:text-red-700 font-medium transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}
