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
  const [csvDownloaded, setCsvDownloaded] = useState(false);

  const isCrossAccount = destAccountId !== campaign.account_id;
  const destAccount = allAccounts.find((a) => a.account_id === destAccountId) ?? allAccounts[0];
  const hasBudget = campaign.budget_type !== 'unknown';
  const currency = campaign.currency ?? 'USD';

  function handleCopyCountChange(n: number) {
    setCopyCount(n);
    setCopies((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) {
        next.push({ name: makeCopyName(campaign.campaign_name, next.length, n), budget: '' });
      }
      // Rename existing when switching count direction
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

  function handleCsvDownload() {
    const newName = copies[0].name;
    const url = `/api/campaigns/${campaign.campaign_id}/export-csv?newName=${encodeURIComponent(newName)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = 'campaign-export.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setCsvDownloaded(true);
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
            onChange={(e) => { setDestAccountId(e.target.value); setResults(null); setCsvDownloaded(false); }}
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
              <label className="block text-xs font-medium text-slate-600 mb-1">New campaign name</label>
              <input
                value={copies[0].name}
                onChange={(e) => updateCopy(0, 'name', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 space-y-1">
              <p className="font-medium">Cross-account export</p>
              <p>Campaign, ad sets, and ads will be exported as a CSV file. Upload it to <strong>{destAccount?.name}</strong> in Facebook Ads Manager → Campaigns → Import Ads in Bulk.</p>
            </div>

            <button
              onClick={handleCsvDownload}
              disabled={!copies[0].name.trim()}
              className="w-full px-4 py-2 text-sm bg-slate-800 text-white rounded-lg hover:bg-slate-900 disabled:opacity-50 transition-colors"
            >
              Download CSV
            </button>

            {csvDownloaded && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-800 space-y-2">
                <p className="font-medium">✓ CSV downloaded</p>
                <p>Open Facebook Ads Manager for <strong>{destAccount?.name}</strong>, go to Campaigns, and click &quot;Import Ads in Bulk&quot; to upload the file.</p>
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
