import { redirect } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getUserRole } from '@/lib/auth-guards';
import ToolsNavActions from './tools-nav-actions';
import type { UserRole } from '@/lib/types';

interface Tool {
  id: string;
  name: string;
  description: string;
  href: string;
  image: string;
  status: 'active' | 'coming-soon';
  badge?: string;
}

const TOOLS: Tool[] = [
  {
    id: 'fb-ads-roas',
    name: "🔥 It's Cooking Time",
    description: "Manage ads campaign. Track live performance, compare snapshots, filter by status, and manage budgets — all in one view.",
    href: '/dashboard',
    image: '/images/morphin-time.png',
    status: 'active',
    badge: 'Live',
  },
  {
    id: 'ads-creative-testing',
    name: "Ads Creative Testing",
    description: "A/B test ad creatives, measure performance across audiences, and identify winning visuals before scaling.",
    href: '#',
    image: '',
    status: 'coming-soon',
    badge: 'Coming Soon',
  },
];

export default async function ToolsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const userRole = ((await getUserRole(user.id)) ?? 'staff') as UserRole;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="px-8 py-5 border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">⚡ Tool Hub</h1>
            <p className="text-slate-500 text-sm mt-0.5">Select a tool to get started</p>
          </div>
          <ToolsNavActions userRole={userRole} />
        </div>
      </header>

      {/* Tool grid */}
      <main className="flex-1 px-8 py-12">
        <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {TOOLS.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      </main>

      <footer className="px-8 py-4 border-t border-slate-200 bg-white text-center text-xs text-slate-400">
        More tools coming soon
      </footer>
    </div>
  );
}

function ToolCard({ tool }: { tool: Tool }) {
  const isLocked = tool.status === 'coming-soon';

  const card = (
    <div
      className={`group relative rounded-2xl overflow-hidden border transition-all duration-200 flex flex-col
        ${isLocked
          ? 'border-slate-200 bg-slate-100 cursor-not-allowed opacity-60'
          : 'border-slate-200 bg-white hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-100 cursor-pointer'
        }`}
    >
      {/* Image area */}
      <div className="relative h-44 w-full bg-slate-800 overflow-hidden">
        {tool.image ? (
          <Image
            src={tool.image}
            alt={tool.name}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          /* Placeholder for tools without an image yet */
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-700 to-slate-800">
            <span className="text-5xl opacity-30">🔧</span>
          </div>
        )}

        {/* Lock overlay for coming-soon tools */}
        {isLocked && (
          <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center">
            <div className="text-center">
              <div className="text-3xl mb-1">🔒</div>
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-widest">Locked</span>
            </div>
          </div>
        )}

        {/* Status badge */}
        <span
          className={`absolute top-3 right-3 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide
            ${isLocked ? 'bg-slate-700 text-slate-400' : 'bg-indigo-600 text-white'}`}
        >
          {tool.badge}
        </span>
      </div>

      {/* Content */}
      <div className="p-5 flex flex-col flex-1">
        <h2 className="text-sm font-bold text-slate-900 mb-1.5 group-hover:text-indigo-600 transition-colors">
          {tool.name}
        </h2>
        <p className="text-xs text-slate-400 leading-relaxed flex-1">{tool.description}</p>

        {!isLocked && (
          <div className="mt-4 flex items-center gap-1 text-xs font-medium text-indigo-400 group-hover:text-indigo-300 transition-colors">
            Open tool <span className="group-hover:translate-x-0.5 transition-transform">→</span>
          </div>
        )}
      </div>
    </div>
  );

  if (isLocked) return card;
  return <Link href={tool.href}>{card}</Link>;
}
