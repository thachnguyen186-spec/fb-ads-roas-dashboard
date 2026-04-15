'use client';

import { useState } from 'react';
import type { MergedCampaign, FbAdAccount } from '@/lib/types';

interface Props {
  campaign: MergedCampaign;
  allAccounts: FbAdAccount[];
  onClose: () => void;
  onComplete: () => void;
}

type CopyRow = { name: string; budget: string };
type CopyResult = { name: string; success: boolean; campaign_id?: string; error?: string };

function makeCopyName(baseName: string, index: number, total: number) {
  return total === 1 ? `Copy of ${baseName}` : `Copy of ${baseName} ${index + 1}`;
}

export default function DuplicateCampaignModal({ campaign, allAccounts, onClose, onComplete }: Props) {
  const [destAccountId, setDestAccountId] = useState(campaign.account_id);
  const [copyCount, setCopyCount] = useState(1);
  const [copies, setCopies] = useState<CopyRow[]>([{ name: `Copy of ${campaign.campaign_name}`, budget: '' }]);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<CopyResult[] | null>(null);
  // tracks which copy indices have been downloaded (cross-account)
  const [downloadedIndices, setDownloadedIndices] = useState<Set<number>>(new Set());
  // per-copy download errors (cross-account) — index → error message
  const [downloadErrors, setDownloadErrors] = useState<Record<number, string>>({});
  // which indices are currently fetching
  const [downloadingIndices, setDownloadingIndices] = useState<Set<number>>(new Set());

  const isCrossAccount = destAccountId !== campaign.account_id;
  const destAccount = allAccounts.find((a) => a.account_id === destAccountId) ?? allAccounts[0];
  const hasBudget = campaign.budget_type !== 'unknown';
  const currency = campaign.currency ?? 'USD';

  function handleCopyCountChange(n: number) {
    setCopyCount(n);
    setDownloadedIndices(new Set());
    setCopies((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) {
        next.push({ name: makeCopyName(campaign.campaign_name, next.length, n), budget: '' });
      }
      // Rename existing entries when count changes
      return next.map((c, i) => ({ ...c, name: makeCopyName(campaign.campaign_name, i, n) }));
    });
  }

  function updateCopy(i: number, field: keyof CopyRow, val: string) {
    setCopies((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: val } : c)));
  }

  async function handleSameAccountSubmit() {
    setSubmitting(true);
    setResults(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign.campaign_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'duplicate',
          source_account_id: campaign.account_id,
          currency,
          copies: copies.map((c) => ({
            name: c.name,
            ...(c.budget && hasBudget ? {
              budget_amount: parseFloat(c.budget),
              budget_type: campaign.budget_type === 'daily' ? 'daily' : 'lifetime',
            } : {}),
          })),
        }),
      });
      const data = await res.json() as { results?: CopyResult[] };
      const res2 = data.results ?? [];
      setResults(res2);
      if (res2.length > 0 && res2.every((r) => r.success)) {
        setTimeout(onComplete, 1200);
      }
    } catch (err) {
      setResults([{ name: 'Request failed', success: false, error: err instanceof Error ? err.message : 'Network error' }]);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCsvDownload(index: number) {
    const newName = copies[index].name;
    const url = `/api/campaigns/${campaign.campaign_id}/export-csv?newName=${encodeURIComponent(newName)}`;

    // Clear previous error for this index and mark as loading
    setDownloadErrors((prev) => { const next = { ...prev }; delete next[index]; return next; });
    setDownloadingIndices((prev) => new Set([...prev, index]));

    try {
      const res = await fetch(url);

      if (!res.ok) {
        // Parse the JSON error body so the user sees the actual reason
        let errMsg = `HTTP ${res.status}`;
        try {
          const data = await res.json() as { error?: string };
          if (data.error) errMsg = data.error;
        } catch { /* ignore parse error */ }
        setDownloadErrors((prev) => ({ ...prev, [index]: errMsg }));
        return;
      }

      // Success — convert to blob and trigger browser download
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `campaign-export${copies.length > 1 ? `-${index + 1}` : ''}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      setDownloadedIndices((prev) => new Set([...prev, index]));
    } catch (err) {
      setDownloadErrors((prev) => ({ ...prev, [index]: err instanceof Error ? err.message : 'Network error' }));
    } finally {
      setDownloadingIndices((prev) => { const next = new Set(prev); next.delete(index); return next; });
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Duplicate Campaign</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>

        {/* Source info */}
        <div className="bg-slate-50 rounded-lg p-3 text-sm">
          <p className="font-medium text-slate-800 truncate" title={campaign.campaign_name}>{campaign.campaign_name}</p>
          <p className="text-slate-500 text-xs mt-0.5">{campaign.account_id} · {campaign.budget_type !== 'unknown' ? campaign.budget_type + ' budget' : 'CBO'}</p>
        </div>

        {/* Destination account */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Destination account</label>
          <select
            value={destAccountId}
            onChange={(e) => { setDestAccountId(e.target.value); setResults(null); setDownloadedIndices(new Set()); setDownloadErrors({}); }}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {allAccounts.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {a.name} ({a.account_id}){a.account_id === campaign.account_id ? ' — same' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Same-account flow */}
        {!isCrossAccount && (
          <>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Number of copies</label>
              <select
                value={copyCount}
                onChange={(e) => handleCopyCountChange(Number(e.target.value))}
                className="w-28 px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {copies.map((copy, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    value={copy.name}
                    onChange={(e) => updateCopy(i, 'name', e.target.value)}
                    placeholder="Campaign name"
                    className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  {hasBudget && (
                    <input
                      type="number"
                      min="0"
                      value={copy.budget}
                      onChange={(e) => updateCopy(i, 'budget', e.target.value)}
                      placeholder={`Budget (${currency})`}
                      className="w-32 px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  )}
                </div>
              ))}
            </div>
            {!hasBudget && (
              <p className="text-xs text-slate-500">Budget managed at ad set level — no campaign budget override available.</p>
            )}

            {/* Results */}
            {results && (
              <div className="space-y-1">
                {results.map((r, i) => (
                  <div key={i} className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg ${r.success ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
                    <span>{r.success ? '✓' : '✗'}</span>
                    <span className="truncate">{r.name}</span>
                    {r.error && <span className="text-xs ml-auto">{r.error}</span>}
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
              <button
                onClick={handleSameAccountSubmit}
                disabled={submitting || copies.some((c) => !c.name.trim())}
                className="px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Duplicating…' : `Duplicate →`}
              </button>
            </div>
          </>
        )}

        {/* Cross-account flow */}
        {isCrossAccount && (
          <>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Number of copies</label>
              <select
                value={copyCount}
                onChange={(e) => handleCopyCountChange(Number(e.target.value))}
                className="w-28 px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              <p className="font-medium mb-0.5">Cross-account export</p>
              <p>Each CSV contains the full campaign structure. Upload to <strong>{destAccount?.name}</strong> in Facebook Ads Manager → Campaigns → Import Ads in Bulk.</p>
            </div>

            {/* Per-copy name + download button */}
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {copies.map((copy, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex gap-2 items-center">
                    <input
                      value={copy.name}
                      onChange={(e) => updateCopy(i, 'name', e.target.value)}
                      placeholder="Campaign name"
                      className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      onClick={() => handleCsvDownload(i)}
                      disabled={!copy.name.trim() || downloadingIndices.has(i)}
                      className="px-3 py-1.5 text-sm bg-slate-800 text-white rounded-lg hover:bg-slate-900 disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      {downloadingIndices.has(i) ? '…' : downloadedIndices.has(i) ? '✓ Done' : '↓ CSV'}
                    </button>
                  </div>
                  {downloadErrors[i] && (
                    <p className="text-xs text-red-600 pl-1">Error: {downloadErrors[i]}</p>
                  )}
                </div>
              ))}
            </div>

            {downloadedIndices.size > 0 && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-800 space-y-1">
                <p className="font-medium">✓ {downloadedIndices.size}/{copies.length} downloaded</p>
                <p>Import each file in Facebook Ads Manager for <strong>{destAccount?.name}</strong>.</p>
                <a
                  href="https://business.facebook.com/adsmanager"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-indigo-600 underline hover:text-indigo-800"
                >
                  Open Ads Manager ↗
                </a>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
