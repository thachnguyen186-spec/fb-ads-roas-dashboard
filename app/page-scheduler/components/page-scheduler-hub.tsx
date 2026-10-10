'use client';

import { useState, type ComponentType } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import type { UserRole } from '@/lib/types';
import SettingsTab from './settings-tab';
import QueueTab from './queue-tab';
import UploadTab from './upload-tab';
import AnalyticsTab from './analytics-tab';

/** Props every tab component receives. */
export interface TabProps {
  userEmail: string;
  role: UserRole;
  /** Switch the hub to another tab (e.g. empty-state CTA -> 'settings'). */
  onNavigate?: (tabId: string) => void;
}

interface TabDef {
  id: string;
  label: string;
  /** Later phases set this (one import line + one `component:` entry). Absent = "coming soon". */
  component?: ComponentType<TabProps>;
}

const TABS: TabDef[] = [
  { id: 'upload', label: 'Upload', component: UploadTab },
  { id: 'queue', label: 'Queue', component: QueueTab },
  { id: 'analytics', label: 'Analytics', component: AnalyticsTab },
  { id: 'settings', label: 'Settings', component: SettingsTab },
];

export default function PageSchedulerHub({ userEmail, role }: TabProps) {
  const [active, setActive] = useState('settings');
  const tab = TABS.find((t) => t.id === active) ?? TABS[TABS.length - 1];
  const Active = tab.component;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div>
        <Link href="/tools" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ChevronLeft className="w-4 h-4" /> Tools
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">Facebook Page Scheduler</h1>
        <p className="text-sm text-slate-500 mt-1">Schedule posts to many Pages from CSV/JSON using Facebook native scheduling.</p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              active === t.id
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {Active ? (
        <Active userEmail={userEmail} role={role} onNavigate={setActive} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
          {tab.label} is coming soon.
        </div>
      )}
    </div>
  );
}
