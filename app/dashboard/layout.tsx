/**
 * Tab switcher wrapping the FB (`/dashboard`) and TikTok (`/dashboard/tiktok`) dashboards.
 * Data-free by design — each page owns its own fetch, so switching tabs unmounts the other
 * platform's component tree and its in-flight state (independence guarantee, Phase 3).
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/dashboard', label: 'Facebook' },
  { href: '/dashboard/tiktok', label: 'TikTok' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col h-screen">
      <nav className="flex-shrink-0 flex gap-1 bg-white border-b border-slate-200 px-6 pt-2">
        {TABS.map((tab) => {
          const active = tab.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-4 py-1.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                active
                  ? 'border-indigo-600 text-indigo-700 bg-indigo-50'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {/* Bounds each page's own min-h-screen root to the remaining viewport instead of letting
          it stack on top of the nav bar's height (which would grow body past 100vh on every phase
          of both dashboards, not just TikTok's). */}
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
