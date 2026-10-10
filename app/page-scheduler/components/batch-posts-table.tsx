'use client';

import { MAX_SCHEDULE_DAYS } from '@/lib/page-scheduler/constants';
import { formatBangkok } from '@/lib/page-scheduler/schedule-time';
import PostRowActions, { type QueuePost } from './post-row-actions';

export interface DetailPost extends QueuePost {
  user_id: string;
  row_number: number;
  page_id: string;
  page_name: string;
  image_kind: string;
  image_ref: string | null;
  thumb_url: string | null;
  permalink_url: string | null;
}

export const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  queued: 'bg-blue-50 text-blue-700',
  waiting: 'bg-amber-50 text-amber-700',
  pushing: 'bg-indigo-50 text-indigo-700',
  scheduled: 'bg-emerald-50 text-emerald-700',
  published: 'bg-green-100 text-green-800',
  failed: 'bg-red-50 text-red-700',
  cancelled: 'bg-slate-100 text-slate-400',
};

interface Props {
  posts: DetailPost[];
  isOwner: boolean;
  ownerEmail: string | null;
  onChanged: () => void;
  onNotice: (msg: string, link?: string) => void;
}

export default function BatchPostsTable({ posts, isOwner, ownerEmail, onChanged, onNotice }: Props) {
  if (posts.length === 0) return <p className="text-sm text-slate-500 py-6 text-center">No posts match this filter.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
            <th className="py-2 pr-2">#</th>
            <th className="pr-2">Time (BKK)</th>
            <th className="pr-2">Page</th>
            <th className="pr-2">Post</th>
            <th className="pr-2">Countries</th>
            <th className="pr-2">Status</th>
            {isOwner ? <th /> : ownerEmail && <th className="pr-2">Owner</th>}
          </tr>
        </thead>
        <tbody>
          {posts.map((p) => {
            const fbLink = p.permalink_url ?? (p.fb_post_id ? `https://www.facebook.com/${p.fb_post_id}` : null);
            return (
              <tr key={p.id} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-2 text-slate-400">{p.row_number}</td>
                <td className="pr-2 whitespace-nowrap">{formatBangkok(p.scheduled_at)}</td>
                <td className="pr-2 max-w-[10rem] truncate" title={p.page_name}>{p.page_name || p.page_id}</td>
                <td className="pr-2 max-w-xs">
                  <div className="flex gap-2 items-start">
                    {p.thumb_url && (
                      // eslint-disable-next-line @next/next/no-img-element -- signed/external URLs, not optimizable
                      <img src={p.thumb_url} alt="" className="w-10 h-10 rounded object-cover shrink-0" loading="lazy" />
                    )}
                    <span className="line-clamp-2 text-slate-700">{p.message || <em className="text-slate-400">(image only)</em>}</span>
                  </div>
                </td>
                <td className="pr-2 text-xs text-slate-500 max-w-[8rem] truncate" title={p.countries.join(', ')}>{p.countries.length ? p.countries.join(', ') : 'ALL'}</td>
                <td className="pr-2 max-w-[16rem]">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[p.status] ?? ''}`}>{p.status}</span>
                  {p.status === 'waiting' && (
                    <div className="text-xs text-amber-700 mt-1">auto-push after {formatBangkok(Date.parse(p.scheduled_at) - MAX_SCHEDULE_DAYS * 86_400_000).slice(0, 10)}</div>
                  )}
                  {p.error && p.status !== 'scheduled' && <div className="text-xs text-red-600 mt-1 break-words">{p.error}</div>}
                  {fbLink && <a href={fbLink} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline block mt-1">View on Facebook</a>}
                </td>
                {isOwner ? (
                  <td className="whitespace-nowrap"><PostRowActions post={p} onChanged={onChanged} onNotice={onNotice} /></td>
                ) : ownerEmail && <td className="pr-2 text-xs text-slate-500">{ownerEmail}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
