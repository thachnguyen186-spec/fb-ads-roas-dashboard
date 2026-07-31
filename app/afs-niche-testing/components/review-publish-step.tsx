'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AfsBatch, AfsPublishResult, AfsTopic, AfsTopicStatus } from '@/lib/types';
import { matchesRiskKeyword, SPECIAL_CATEGORY_OVERRIDE_PHRASE as CONFIRM_PHRASE } from '@/lib/afs/risk-keywords';
import type { CreativeWithUrl } from './generation-progress-step';
import TopicReviewCard from './topic-review-card';

interface Props {
  batch: AfsBatch;
  topics: AfsTopic[];
  creativesByTopic: Record<string, CreativeWithUrl[]>;
  onRefetchBatch: () => void;
}

const PUBLISHABLE_STATUSES = new Set<AfsTopicStatus>(['ready', 'partial_failed', 'publishing']);
const RESULT_STATUSES = new Set<AfsTopicStatus>(['published', 'partial_failed', 'failed']);
const RESULT_BADGE: Record<string, string> = { published: 'bg-emerald-100 text-emerald-700', partial_failed: 'bg-amber-100 text-amber-700', failed: 'bg-red-100 text-red-700' };
const formatMajor = (major: number, currency: string) => (currency === 'VND' ? Math.round(major).toLocaleString() : major.toFixed(2));
const adsManagerUrl = (accountId: string, campaignId: string) =>
  `https://adsmanager.facebook.com/admanager/manage/campaigns?act=${encodeURIComponent(accountId)}&selected_campaign_ids=${encodeURIComponent(campaignId)}`;

const STEP_LABELS: Record<string, string> = { campaign: 'Creating campaign…', adset: 'Creating ad set…' };
function describeStep(step?: string, creativeIndex?: number): string {
  if (step === 'creative') return `Publishing creative ${(creativeIndex ?? 0) + 1}/5…`;
  return (step && STEP_LABELS[step]) || 'Working…';
}

type StepResponse = { done: boolean; step?: string; creativeIndex?: number; result?: AfsPublishResult; error?: string };
type TopicStepState = { label?: string; error?: string };

export default function ReviewPublishStep({ batch, topics, creativesByTopic, onRefetchBatch }: Props) {
  const [localTopics, setLocalTopics] = useState<AfsTopic[]>(topics);
  const [syncedTopics, setSyncedTopics] = useState(topics);
  if (topics !== syncedTopics) { setSyncedTopics(topics); setLocalTopics(topics); }
  const [accountCurrencyMap, setAccountCurrencyMap] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch('/api/afs-niche-testing/fb-assets').then((r) => r.json()).then((json) => {
      const map: Record<string, string> = {};
      for (const a of json.ad_accounts ?? []) map[a.account_id] = a.currency;
      setAccountCurrencyMap(map);
    }).catch(() => {});
  }, []);
  const [confirmInputs, setConfirmInputs] = useState<Record<string, string>>({});
  const [publishActive, setPublishActive] = useState(batch.publish_active);
  const [syncedBatchActive, setSyncedBatchActive] = useState(batch.publish_active);
  if (batch.publish_active !== syncedBatchActive) { setSyncedBatchActive(batch.publish_active); setPublishActive(batch.publish_active); }
  const [publishing, setPublishing] = useState(false);
  const [stepState, setStepState] = useState<Record<string, TopicStepState>>({});
  const [results, setResults] = useState<Record<string, AfsPublishResult>>({});
  const [stopped, setStopped] = useState(false);
  const handleTopicUpdated = (updated: AfsTopic) => setLocalTopics((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  const setTopicStep = (id: string, patch: TopicStepState) => setStepState((prev) => ({ ...prev, [id]: patch }));
  const clearTopicStep = (id: string) => setStepState((prev) => { const next = { ...prev }; delete next[id]; return next; });
  const missingFieldBlockers = useMemo(() => localTopics
    .filter((t) => PUBLISHABLE_STATUSES.has(t.status))
    .flatMap((t) => {
      const reasons: string[] = [];
      if (!t.ad_account_id) reasons.push('missing ad account');
      if (!t.page_id) reasons.push('missing Page');
      if (!t.countries || t.countries.length === 0) reasons.push('no countries selected');
      if (t.daily_budget_minor <= 0) reasons.push('daily budget must be greater than 0');
      if ((creativesByTopic[t.id] ?? []).filter((c) => c.status === 'succeeded').length === 0) reasons.push('no succeeded creatives');
      return reasons.map((reason) => ({ topicId: t.id, label: t.topic_text, reason }));
    }), [localTopics, creativesByTopic]);
  const keywordBlockers = useMemo(() => localTopics
    .filter((t) => PUBLISHABLE_STATUSES.has(t.status))
    .filter((t) => matchesRiskKeyword(t.topic_text) && t.special_ad_category === 'NONE')
    .filter((t) => (confirmInputs[t.id] ?? '') !== CONFIRM_PHRASE)
    .map((t) => ({ topicId: t.id, label: t.topic_text })), [localTopics, confirmInputs]);
  const spendRows = useMemo(() => {
    const groups: Record<string, { totalMinor: number; count: number }> = {};
    for (const t of localTopics) {
      const currency = (t.ad_account_id && accountCurrencyMap[t.ad_account_id]) || 'USD';
      const g = groups[currency] ?? { totalMinor: 0, count: 0 };
      g.totalMinor += t.daily_budget_minor || 0;
      g.count += 1;
      groups[currency] = g;
    }
    return Object.entries(groups).map(([currency, g]) => ({ currency, count: g.count, major: currency === 'VND' ? g.totalMinor : g.totalMinor / 100 }));
  }, [localTopics, accountCurrencyMap]);
  const remaining = localTopics.filter((t) => PUBLISHABLE_STATUSES.has(t.status));
  const attempted = Object.keys(stepState).length + Object.keys(results).length > 0;
  const disablePublish = publishing || remaining.length === 0 || missingFieldBlockers.length > 0 || keywordBlockers.length > 0;
  const statusTopics = localTopics.filter((t) => stepState[t.id] || results[t.id] || RESULT_STATUSES.has(t.status));
  const patchPublishActive = (next: boolean): Promise<boolean> =>
    fetch(`/api/afs-niche-testing/batches/${batch.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publish_active: next }),
    }).then((res) => res.ok).catch(() => false);
  async function handleToggleActive(checked: boolean) {
    setPublishActive(checked);
    await patchPublishActive(checked);
    if (!checked) return;
    const lines = spendRows.map((r) => `${formatMajor(r.major, r.currency)} ${r.currency}/day across ${r.count} campaign(s)`).join('\n');
    const confirmed = window.confirm(
      `Turning this ON launches campaigns as ACTIVE (spending real money immediately) instead of PAUSED.\n\nTotal daily spend:\n${lines}\n\nThis only controls spend risk — whether campaigns run live or paused. It does NOT reduce Facebook's review/compliance risk: every ad is reviewed by Meta regardless of this setting; getting the special-ad-category and copy right is what protects the account, not this toggle.`,
    );
    if (!confirmed) { setPublishActive(false); await patchPublishActive(false); }
  }
  async function runPublishLoop() {
    setPublishing(true);
    setStopped(false);
    const queue = localTopics.filter((t) => PUBLISHABLE_STATUSES.has(t.status));
    for (const topic of queue) {
      let done = false;
      let hardStop = false;
      setTopicStep(topic.id, { label: 'Starting…' });
      while (!done) {
        let json: StepResponse;
        try {
          // Server re-checks the special-ad-category keyword blocker itself — this override
          // phrase is only meaningful when that topic actually needs it; harmless otherwise.
          const res = await fetch(`/api/afs-niche-testing/topics/${topic.id}/publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ override_confirmation: confirmInputs[topic.id] ?? '' }),
          });
          json = await res.json();
          if (!res.ok) {
            const message = json.error ?? 'Publish failed';
            setTopicStep(topic.id, { error: message });
            // FB's actual throttle errors read like "(#17) User request limit reached" or
            // "(#80004) There have been too many calls…" — neither contains "rate limit"
            // literally, so match FB's own wording too, not just Kie's.
            if (/rate limit|request limit|too many calls/i.test(message)) hardStop = true;
            break;
          }
        } catch (err) {
          setTopicStep(topic.id, { error: err instanceof Error ? err.message : 'Network error' });
          hardStop = true;
          break;
        }
        done = json.done;
        if (done) {
          clearTopicStep(topic.id);
          if (json.result) setResults((prev) => ({ ...prev, [topic.id]: json.result as AfsPublishResult }));
        } else {
          setTopicStep(topic.id, { label: describeStep(json.step, json.creativeIndex) });
        }
      }
      if (hardStop) { setStopped(true); break; }
    }
    setPublishing(false);
    onRefetchBatch();
  }
  return (
    <div className="space-y-4">
      {(missingFieldBlockers.length > 0 || keywordBlockers.length > 0) && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-red-700">Publish blocked</p>
          {missingFieldBlockers.map((b, i) => <p key={`${b.topicId}-${i}`} className="text-xs text-red-700">&bull; &ldquo;{b.label}&rdquo;: {b.reason}</p>)}
          {keywordBlockers.map((b) => (
            <div key={b.topicId} className="text-xs text-red-700 space-y-1">
              <p>&bull; &ldquo;{b.label}&rdquo; looks employment/housing/credit-adjacent but special ad category is None — Facebook policy requires the matching category.</p>
              <input value={confirmInputs[b.topicId] ?? ''} onChange={(e) => setConfirmInputs((prev) => ({ ...prev, [b.topicId]: e.target.value }))}
                placeholder={CONFIRM_PHRASE} className="w-full max-w-md px-2 py-1 border border-red-300 rounded-lg text-xs font-mono" />
            </div>
          ))}
        </div>
      )}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-900">Daily spend</p>
          {spendRows.map((r) => <p key={r.currency} className="text-sm text-slate-700">{formatMajor(r.major, r.currency)} {r.currency}/day across {r.count} campaign(s)</p>)}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={publishActive} onChange={(e) => handleToggleActive(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
          Publish as ACTIVE (default off = PAUSED — spend risk only, not a review/compliance safeguard)
        </label>
      </div>
      <div className="space-y-3">
        {localTopics.map((topic) => (
          <TopicReviewCard key={topic.id} topic={topic} creatives={creativesByTopic[topic.id] ?? []}
            accountCurrencyMap={accountCurrencyMap} onTopicUpdated={handleTopicUpdated} onRefetchBatch={onRefetchBatch} />
        ))}
      </div>
      <button onClick={runPublishLoop} disabled={disablePublish} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50">
        {publishing ? 'Publishing…' : (stopped || attempted) && remaining.length > 0 ? `Resume publish (${remaining.length} left)` : `Publish ${remaining.length} topic(s)`}
      </button>
      {statusTopics.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-slate-900">Publish status</p>
          {statusTopics.map((t) => {
            const step = stepState[t.id];
            if (step) return <p key={t.id} className={`text-xs ${step.error ? 'text-red-600' : 'text-slate-600'}`}>{t.topic_text}: {step.error ?? step.label}</p>;
            const r = results[t.id];
            const status = r?.status ?? t.status;
            const error = r?.error ?? t.error ?? undefined;
            const campaignId = r?.campaign_id ?? t.fb_campaign_id ?? undefined;
            return (
              <div key={t.id} className="text-xs text-slate-700 flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full font-medium shrink-0 ${RESULT_BADGE[status] ?? 'bg-slate-100 text-slate-600'}`}>{status}</span>
                <span className="truncate">{t.topic_text}</span>
                {error && <span className="text-red-600 truncate">{error}</span>}
                {campaignId && t.ad_account_id && (
                  <a href={adsManagerUrl(t.ad_account_id, campaignId)} target="_blank" rel="noreferrer" className="text-indigo-600 underline shrink-0">Ads Manager</a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
