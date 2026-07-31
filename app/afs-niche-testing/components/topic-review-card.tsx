'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AfsTopic } from '@/lib/types';
import type { CreativeWithUrl } from './generation-progress-step';
import ConnectionSelectors, { type ConnectionDefaults } from './connection-selectors';

interface Props {
  topic: AfsTopic;
  creatives: CreativeWithUrl[];
  /** ad_account_id → currency, fetched once by the parent to avoid N redundant /fb-assets calls. */
  accountCurrencyMap: Record<string, string>;
  onTopicUpdated: (topic: AfsTopic) => void;
  onRefetchBatch: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600', generating: 'bg-indigo-100 text-indigo-700',
  ready: 'bg-emerald-100 text-emerald-700', publishing: 'bg-indigo-100 text-indigo-700',
  published: 'bg-emerald-100 text-emerald-700', partial_failed: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
};
const INPUT_CLS = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

function toMajorString(minor: number, currency: string): string {
  const major = currency === 'VND' ? minor : minor / 100;
  return Number.isFinite(major) && major > 0 ? String(major) : '';
}

function CreativeThumb({ creative, onEnlarge }: { creative?: CreativeWithUrl; onEnlarge: (url: string) => void }): ReactNode {
  if (!creative) return <div className="w-16 h-16 rounded-lg bg-slate-100 shrink-0" />;
  if (creative.status === 'succeeded' && creative.signed_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- private signed Storage URL, not an optimizable static asset
      <img src={creative.signed_url} alt={creative.image_headline} onClick={() => onEnlarge(creative.signed_url as string)}
        className="w-16 h-16 rounded-lg object-cover border border-slate-200 shrink-0 cursor-pointer hover:opacity-80" />
    );
  }
  if (creative.status === 'failed') {
    return (
      <div className="w-16 h-16 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center p-1 shrink-0" title={creative.error ?? 'Generation failed'}>
        <span className="text-[9px] text-red-600 text-center leading-tight line-clamp-4">{creative.error ?? 'Failed'}</span>
      </div>
    );
  }
  return <div className="w-16 h-16 rounded-lg bg-slate-100 animate-pulse shrink-0" />;
}

export default function TopicReviewCard({ topic, creatives, accountCurrencyMap, onTopicUpdated, onRefetchBatch }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [enlarged, setEnlarged] = useState<string | null>(null);
  const [primaryText, setPrimaryText] = useState(topic.primary_text);
  const [adHeadline, setAdHeadline] = useState(topic.ad_headline);
  const [targetUrl, setTargetUrl] = useState(topic.target_url);
  const [connection, setConnection] = useState<ConnectionDefaults>(() => {
    const currency = (topic.ad_account_id && accountCurrencyMap[topic.ad_account_id]) || 'USD';
    return {
      ad_account_id: topic.ad_account_id ?? '', page_id: topic.page_id ?? '', page_name: topic.page_name ?? '',
      pixel_id: topic.pixel_id ?? '', countries: topic.countries ?? [], special_ad_category: topic.special_ad_category,
      daily_budget_major: toMajorString(topic.daily_budget_minor, currency), currency,
    };
  });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const seededCurrency = useRef(Boolean(topic.ad_account_id && accountCurrencyMap[topic.ad_account_id]));
  const isFirstRun = useRef(true);

  const locked = topic.status === 'publishing' || topic.status === 'published';

  // ConnectionSelectors only resolves currency when the user actively changes the Ad Account dropdown — it
  // never retroactively resolves currency for a pre-selected value. Seed it here, once, as soon as the
  // parent's /fb-assets fetch resolves, without clobbering later user edits.
  useEffect(() => {
    if (seededCurrency.current || !topic.ad_account_id) return;
    const resolved = accountCurrencyMap[topic.ad_account_id];
    if (!resolved) return;
    seededCurrency.current = true;
    setConnection((prev) => ({ ...prev, currency: resolved, daily_budget_major: toMajorString(topic.daily_budget_minor, resolved) }));
  }, [accountCurrencyMap, topic.ad_account_id, topic.daily_budget_minor]);

  async function save() {
    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/afs-niche-testing/topics/${topic.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_url: targetUrl, primary_text: primaryText, ad_headline: adHeadline,
          countries: connection.countries, special_ad_category: connection.special_ad_category,
          ad_account_id: connection.ad_account_id || null, page_id: connection.page_id || null,
          page_name: connection.page_name || null, pixel_id: connection.pixel_id || null,
          daily_budget_major: parseFloat(connection.daily_budget_major), currency: connection.currency,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to save');
      setSaveStatus('saved');
      onTopicUpdated(json.topic as AfsTopic);
    } catch (e) {
      setSaveStatus('error');
      setSaveError(e instanceof Error ? e.message : 'Failed to save');
    }
  }

  useEffect(() => {
    if (locked) return;
    if (isFirstRun.current) { isFirstRun.current = false; return; }
    setSaveStatus('idle');
    const timer = setTimeout(save, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `save` closes over the fields below; those are the real deps
  }, [primaryText, adHeadline, targetUrl, connection, locked]);

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/afs-niche-testing/topics/${topic.id}/generate`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Regenerate failed');
      onRefetchBatch();
    } catch {
      // Failure surfaces via topic.error on the next refetch — afs-hub already polls while any topic is 'generating'.
    } finally {
      setRegenerating(false);
    }
  }

  const succeededCount = creatives.filter((c) => c.status === 'succeeded').length;
  const slots = Array.from({ length: 5 }, (_, i) => creatives[i]);
  const regenerateDisabled = regenerating || locked || Boolean(topic.fb_campaign_id) || topic.status === 'generating';

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setExpanded((v) => !v)} className="flex items-center gap-2 min-w-0 text-left">
          {expanded ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 truncate">{topic.topic_text}</p>
            <p className="text-xs text-slate-400">{succeededCount}/5 images ready</p>
          </div>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[topic.status] ?? 'bg-slate-100 text-slate-600'}`}>{topic.status}</span>
          <button type="button" onClick={handleRegenerate} disabled={regenerateDisabled}
            title={topic.fb_campaign_id ? 'Cannot regenerate — a campaign has already been created for this topic' : undefined}
            className="text-xs px-3 py-1 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 disabled:opacity-50">
            {regenerating ? 'Regenerating…' : 'Regenerate topic'}
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        {slots.map((c, i) => <CreativeThumb key={c?.id ?? i} creative={c} onEnlarge={setEnlarged} />)}
      </div>

      {expanded && (
        <div className="space-y-3 pt-2 border-t border-slate-100">
          {locked ? (
            <p className="text-xs text-slate-500">Editing locked — this topic is {topic.status}.</p>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Target URL</label>
                <input value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} className={INPUT_CLS} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Primary text</label>
                <textarea value={primaryText} onChange={(e) => setPrimaryText(e.target.value)} rows={3} className={INPUT_CLS} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Ad headline</label>
                <input value={adHeadline} onChange={(e) => setAdHeadline(e.target.value)} className={INPUT_CLS} />
              </div>
              <ConnectionSelectors value={connection} onChange={setConnection} />
              <p className={`text-xs ${saveStatus === 'error' ? 'text-red-600' : 'text-slate-400'}`}>
                {saveStatus === 'saving' && 'Saving…'}
                {saveStatus === 'saved' && 'Saved'}
                {saveStatus === 'error' && `Failed to save: ${saveError}`}
              </p>
            </>
          )}
        </div>
      )}

      {enlarged && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8" onClick={() => setEnlarged(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- private signed Storage URL */}
          <img src={enlarged} alt="Creative preview" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
    </div>
  );
}
