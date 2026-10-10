import { formatBangkok } from '@/lib/page-scheduler/schedule-time';
import type { SortKey } from '@/lib/page-scheduler/analytics-aggregate';

export interface TopPost {
  id: string;
  page_name: string;
  message: string;
  published_at: string | null;
  permalink_url: string | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  clicks: number | null;
  engagement: number;
  metrics_at: string | null;
  metrics_error: string | null;
  owner_email: string | null;
}

const COLS: { key: SortKey; label: string }[] = [
  { key: 'reactions', label: 'Reactions' },
  { key: 'comments', label: 'Comments' },
  { key: 'shares', label: 'Shares' },
  { key: 'views', label: 'Views' },
  { key: 'clicks', label: 'Clicks' },
  { key: 'engagement', label: 'Total' },
];

const n = (v: number | null) => (v === null ? '–' : v.toLocaleString());

interface Props {
  posts: TopPost[];
  sort: SortKey;
  onSort: (k: SortKey) => void;
  showOwner: boolean;
}

export default function AnalyticsTopPosts({ posts, sort, onSort, showOwner }: Props) {
  if (posts.length === 0) return <p className="text-sm text-slate-500">No published posts in this range yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
            <th className="py-1.5 pr-3 font-medium">Post</th>
            <th className="pr-3 font-medium whitespace-nowrap">Published (BKK)</th>
            {COLS.map((c) => (
              <th key={c.key} className="pr-3 font-medium text-right">
                <button onClick={() => onSort(c.key)} className={sort === c.key ? 'text-indigo-700 font-semibold' : 'hover:text-slate-700'}>
                  {c.label}{sort === c.key ? ' ↓' : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {posts.map((p) => (
            <tr key={p.id} className="align-top">
              <td className="py-1.5 pr-3 max-w-xs">
                <div className="text-slate-800 truncate">
                  {p.permalink_url
                    ? <a href={p.permalink_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{p.message.slice(0, 80) || '(image only)'}</a>
                    : (p.message.slice(0, 80) || '(image only)')}
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {p.page_name}{showOwner && p.owner_email ? ` · ${p.owner_email}` : ''}
                  {p.metrics_error && <span className="text-amber-600" title={p.metrics_error}> · insights unavailable</span>}
                  {!p.metrics_at && <span className="text-slate-400"> · metrics pending</span>}
                </div>
              </td>
              <td className="pr-3 whitespace-nowrap text-slate-600">{p.published_at ? formatBangkok(p.published_at) : '–'}</td>
              {COLS.map((c) => (
                <td key={c.key} className={`pr-3 text-right tabular-nums ${c.key === 'engagement' ? 'font-medium' : ''}`}>{n(p[c.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
