'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getInitials } from '@/lib/utils';
import type { TiktokStaffMember, UserRole } from '@/lib/types';

interface Props {
  userEmail: string;
  userRole: UserRole;
  staffList: TiktokStaffMember[];
  viewingUserId: string | null;
  onViewingChange: (userId: string | null) => void;
}

export default function TiktokHeader({ userEmail, userRole, staffList, viewingUserId, onViewingChange }: Props) {
  const router = useRouter();
  const viewing = staffList.find((s) => s.id === viewingUserId);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="flex-shrink-0 bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Link href="/tools" className="text-xs font-medium text-slate-600 hover:text-indigo-600 transition-colors flex items-center gap-1 mr-1">
          <ChevronLeft className="w-3.5 h-3.5" /> Tools
        </Link>
        <h1 className="text-sm font-semibold text-slate-900">TikTok Ads</h1>
        {(userRole === 'leader' || userRole === 'admin') && staffList.length > 0 && (
          <select
            value={viewingUserId ?? ''}
            onChange={(e) => onViewingChange(e.target.value || null)}
            className="text-xs border border-slate-300 rounded-lg px-2 py-1 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">My accounts</option>
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>{s.email}</option>
            ))}
          </select>
        )}
        {viewing && (
          <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">Viewing: {viewing.email}</span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-semibold flex items-center justify-center select-none">
            {getInitials(userEmail)}
          </span>
          <span className="text-xs text-slate-400 hidden sm:block max-w-[120px] truncate">{userEmail}</span>
        </div>
        <Link href="/settings" className="text-sm text-slate-500 hover:text-slate-800">Settings</Link>
        <span className="text-slate-200 select-none">|</span>
        <button onClick={handleSignOut} className="text-sm text-red-500 hover:text-red-700 font-medium transition-colors">Sign out</button>
      </div>
    </header>
  );
}
