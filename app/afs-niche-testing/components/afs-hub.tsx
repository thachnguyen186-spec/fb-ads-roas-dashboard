'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import type { AfsBatch, AfsTopic, UserRole } from '@/lib/types';
import TopicInputStep, { type TopicRow } from './topic-input-step';
import ConnectionSelectors, { DEFAULT_CONNECTION, type ConnectionDefaults } from './connection-selectors';
import GenerationProgressStep, { type CreativeWithUrl } from './generation-progress-step';
import ReviewPublishStep from './review-publish-step';

interface Props {
  userEmail: string;
  role: UserRole;
}

type Step = 'intake' | 'generating' | 'review';

const STORAGE_KEY = 'afs-niche-testing:last-batch-id';
const CONCURRENCY = 2;

export default function AfsHub({ userEmail, role }: Props) {
  const [step, setStep] = useState<Step>('intake');
  const [topicRows, setTopicRows] = useState<TopicRow[]>([]);
  const [topicRowsValid, setTopicRowsValid] = useState(false);
  const [connection, setConnection] = useState<ConnectionDefaults>(DEFAULT_CONNECTION);
  const [batch, setBatch] = useState<AfsBatch | null>(null);
  const [topics, setTopics] = useState<AfsTopic[]>([]);
  const [creatives, setCreatives] = useState<CreativeWithUrl[]>([]);
  const [creating, setCreating] = useState(false);
  const [driverRunning, setDriverRunning] = useState(false);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const fetchBatch = useCallback(async (batchId: string) => {
    const res = await fetch(`/api/afs-niche-testing/batches/${batchId}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `Failed to load batch (${res.status})`);
    setBatch(json.batch);
    setTopics(json.topics ?? []);
    setCreatives(json.creatives ?? []);
  }, []);

  // Reload-recovery: a batch id saved from an earlier session lets a hard-reloaded tab restore state.
  useEffect(() => {
    const savedId = localStorage.getItem(STORAGE_KEY);
    if (!savedId) return;
    fetchBatch(savedId).then(() => setStep('generating')).catch(() => localStorage.removeItem(STORAGE_KEY));
  }, [fetchBatch]);

  const hasGeneratingTopics = topics.some((t) => t.status === 'generating');
  // driverRunning also gates polling — covers the gap before a just-started generate() call shows up locally.
  useEffect(() => {
    if (!batch || (!hasGeneratingTopics && !driverRunning)) return;
    const interval = setInterval(() => {
      fetchBatch(batch.id).catch((e) => setError(e instanceof Error ? e.message : 'Poll failed'));
    }, 3000);
    return () => clearInterval(interval);
  }, [batch, hasGeneratingTopics, driverRunning, fetchBatch]);

  const creativesByTopic = useMemo(() => {
    const map: Record<string, CreativeWithUrl[]> = {};
    for (const c of creatives) (map[c.topic_id] ??= []).push(c);
    return map;
  }, [creatives]);
  const queue = useMemo(() => topics.filter((t) => t.status === 'draft' || t.status === 'failed'), [topics]);
  const allDone = topics.length > 0 && topics.every((t) => t.status !== 'draft' && t.status !== 'generating');
  async function runDriver(batchId: string, ids: string[]) {
    if (ids.length === 0) return;
    setDriverRunning(true);
    const remaining = [...ids];
    async function worker() {
      while (remaining.length > 0) {
        const id = remaining.shift();
        if (!id) break;
        await fetch(`/api/afs-niche-testing/topics/${id}/generate`, { method: 'POST' }).catch(() => {});
      }
    }
    await Promise.allSettled(Array.from({ length: CONCURRENCY }, () => worker()));
    setDriverRunning(false);
    await fetchBatch(batchId).catch((e) => setError(e instanceof Error ? e.message : 'Failed to refresh batch'));
  }

  async function createBatch() {
    setError('');
    if (!topicRowsValid || topicRows.length === 0) { setError('Fix the topic list before generating.'); return; }
    setCreating(true);
    try {
      const major = parseFloat(connection.daily_budget_major);
      // First (and only) conversion of the raw major-unit input — same currency-aware rule as
      // lib/facebook/campaign-actions.ts:145; POST /batches stores daily_budget_minor as given.
      const daily_budget_minor = Number.isFinite(major) && major > 0
        ? (connection.currency === 'VND' ? Math.round(major) : Math.round(major * 100)) : undefined;
      const res = await fetch('/api/afs-niche-testing/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topics: topicRows.map((r) => ({ description: r.description, target_url: r.target_url })),
          ad_account_id: connection.ad_account_id || undefined,
          page_id: connection.page_id || undefined,
          page_name: connection.page_name || undefined,
          pixel_id: connection.pixel_id || undefined,
          countries: connection.countries,
          special_ad_category: connection.special_ad_category,
          ...(daily_budget_minor !== undefined ? { daily_budget_minor } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Failed to create batch (${res.status})`);
      const newTopics = (json.topics ?? []) as AfsTopic[];
      setBatch(json.batch);
      setTopics(newTopics);
      setCreatives([]);
      localStorage.setItem(STORAGE_KEY, json.batch.id);
      setStep('generating');
      await runDriver(json.batch.id, newTopics.map((t) => t.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create batch');
    } finally {
      setCreating(false);
    }
  }

  async function handleRetryTopic(topicId: string) {
    if (!batch) return;
    setRetryingIds((prev) => new Set(prev).add(topicId));
    try {
      const res = await fetch(`/api/afs-niche-testing/topics/${topicId}/generate`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Retry failed');
      await fetchBatch(batch.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retry failed');
    } finally {
      setRetryingIds((prev) => { const next = new Set(prev); next.delete(topicId); return next; });
    }
  }

  function handleResume() {
    if (batch) runDriver(batch.id, queue.map((t) => t.id));
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="px-8 py-5 border-b border-slate-200 bg-white">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <Link href="/tools" className="text-slate-400 hover:text-slate-700"><ChevronLeft className="w-5 h-5" /></Link>
          <div>
            <h1 className="text-xl font-bold text-slate-900">AFS Niche Testing</h1>
            <p className="text-xs text-slate-500">{userEmail} · {role}</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-8 py-6 space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {step === 'intake' && (
          <>
            <TopicInputStep rows={topicRows} onRowsChange={setTopicRows} onValidityChange={setTopicRowsValid} />
            <ConnectionSelectors value={connection} onChange={setConnection} />
            <button
              onClick={createBatch}
              disabled={creating || !topicRowsValid || topicRows.length === 0}
              className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >{creating ? 'Creating…' : 'Create batch & start generation'}</button>
          </>
        )}

        {step === 'generating' && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Generation Progress</h2>
              {queue.length > 0 && !driverRunning && (
                <button onClick={handleResume} className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                  Resume generation ({queue.length} left)
                </button>
              )}
            </div>
            <GenerationProgressStep topics={topics} creativesByTopic={creativesByTopic} onRetryTopic={handleRetryTopic} retryingIds={retryingIds} />
            {allDone && (
              <button onClick={() => setStep('review')} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
                Continue to review
              </button>
            )}
          </>
        )}

        {step === 'review' && batch && (
          <ReviewPublishStep
            batch={batch}
            topics={topics}
            creativesByTopic={creativesByTopic}
            onRefetchBatch={() => fetchBatch(batch.id)}
          />
        )}
      </main>
    </div>
  );
}
