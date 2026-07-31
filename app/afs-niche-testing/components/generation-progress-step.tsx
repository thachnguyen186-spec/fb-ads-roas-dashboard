'use client';

import type { AfsCreative, AfsTopic, AfsTopicStatus } from '@/lib/types';

export type CreativeWithUrl = AfsCreative & { signed_url: string | null };

interface Props {
  topics: AfsTopic[];
  creativesByTopic: Record<string, CreativeWithUrl[]>;
  onRetryTopic: (topicId: string) => void;
  retryingIds: Set<string>;
}

const STATUS_STYLES: Record<AfsTopicStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  generating: 'bg-indigo-100 text-indigo-700',
  ready: 'bg-emerald-100 text-emerald-700',
  publishing: 'bg-indigo-100 text-indigo-700',
  published: 'bg-emerald-100 text-emerald-700',
  partial_failed: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
};

const PENDING_STATUSES = new Set(['pending', 'submitted', 'reconciling']);

function ThumbSlot({ creative }: { creative?: CreativeWithUrl }) {
  if (!creative || PENDING_STATUSES.has(creative.status)) {
    return <div className="w-16 h-16 rounded-lg bg-slate-100 animate-pulse shrink-0" />;
  }
  if (creative.status === 'succeeded' && creative.signed_url) {
    // eslint-disable-next-line @next/next/no-img-element -- private signed Storage URL, not an optimizable static asset
    return <img src={creative.signed_url} alt={creative.style_key} className="w-16 h-16 rounded-lg object-cover border border-slate-200 shrink-0" />;
  }
  return (
    <div
      className="w-16 h-16 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center p-1 shrink-0"
      title={creative.error ?? 'Generation failed'}
    >
      <span className="text-[9px] text-red-600 text-center leading-tight line-clamp-4">{creative.error ?? 'Failed'}</span>
    </div>
  );
}

export default function GenerationProgressStep({ topics, creativesByTopic, onRetryTopic, retryingIds }: Props) {
  return (
    <div className="space-y-3">
      {topics.map((topic) => {
        const creatives = creativesByTopic[topic.id] ?? [];
        const slots = Array.from({ length: 5 }, (_, i) => creatives[i]);
        const canRetry = topic.status === 'draft' || topic.status === 'failed';
        const isRetrying = retryingIds.has(topic.id);
        return (
          <div key={topic.id} className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{topic.topic_text}</p>
                <p className="text-xs text-slate-400 truncate">{topic.target_url}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[topic.status]}`}>
                  {topic.status}
                </span>
                {canRetry && (
                  <button
                    onClick={() => onRetryTopic(topic.id)}
                    disabled={isRetrying}
                    className="text-xs px-3 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {isRetrying ? 'Retrying…' : 'Retry topic'}
                  </button>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              {slots.map((creative, i) => <ThumbSlot key={creative?.id ?? i} creative={creative} />)}
            </div>

            {topic.error && <p className="text-xs text-red-600">{topic.error}</p>}
          </div>
        );
      })}
    </div>
  );
}
