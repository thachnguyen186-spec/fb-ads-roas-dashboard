'use client';

import { useEffect, useState } from 'react';
import type { MergedCampaign, FbAdAccount } from '@/lib/types';
import type { AdSetBudgetInfo } from '@/lib/facebook/adsets';

interface Props {
  campaign: MergedCampaign;
  allAccounts: FbAdAccount[];
  onClose: () => void;
  onComplete: () => void;
}

type CopyRow = { name: string; budget: string };
type AdsetBudgetRow = { name: string; budget: string; budget_type: 'daily' | 'lifetime' | 'cbo' };
type CopyResult = { name: string; success: boolean; campaign_id?: string; error?: string };

function makeCopyName(baseName: string, index: number, total: number) {
  return total === 1 ? `Copy of ${baseName}` : `Copy of ${baseName} ${index + 1}`;
}

export default function DuplicateCampaignModal({ campaign, allAccounts, onClose, onComplete }: Props) {
  const [destAccountId, setDestAccountId] = useState(campaign.account_id);
  const [copyCount, setCopyCount] = useState(1);
  const [copies, setCopies] = useState<CopyRow[]>([{ name: `Copy of ${campaign.campaign_name}`, budget: '' }]);
  const [adsetBudgets, setAdsetBudgets] = useState<AdsetBudgetRow[]>([]);
  const [loadingAdsets, setLoadingAdsets] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<CopyResult[] | null>(null);
  const [csvDownloading, setCsvDownloading] = useState(false);
  const [csvDownloaded, setCsvDownloaded] = useState(false);
  const [csvError, setCsvError] = useState('');

  const isCrossAccount = destAccountId === '__cross__';
  const hasBudget = campaign.budget_type !== 'unknown';
  const currency = campaign.currency ?? 'USD';

  // Fetch adsets for budget pre-fill on mount
  useEffect(() => {
    async function load() {
      setLoadingAdsets(true);
      try {
        const res = await fetch(`/api/campaigns/${campaign.campaign_id}/adsets?all=true`);
        if (!res.ok) return;
        const data = await res.json() as { adsets: AdSetBudgetInfo[] };
        const rows: AdsetBudgetRow[] = (data.adsets ?? [])
          .filter((a) => a.budget_type !== 'cbo')
          .map((a) => ({
            name: a.name,
            budget_type: a.budget_type,
            budget: a.budget_type === 'daily'
              ? String(a.daily_budget ?? '')
              : String(a.lifetime_budget ?? ''),
          }));
        setAdsetBudgets(rows);
      } catch {
        // Non-fatal — user can still duplicate without budget overrides
      } finally {
        setLoadingAdsets(false);
      }
    }
    load();
  }, [campaign.campaign_id]);

  function handleCopyCountChange(n: number) {
    setCopyCount(n);
    setCsvDownloaded(false);
    setCsvError('');
    setCopies((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) {
        next.push({ name: makeCopyName(campaign.campaign_name, next.length, n), budget: '' });
      }
      return next.map((c, i) => ({ ...c, name: makeCopyName(campaign.campaign_name, i, n) }));
    });
  }

  function updateCopy(i: number, field: keyof CopyRow, val: string) {
    setCopies((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: val } : c)));
  }

  function updateAdsetBudget(i: number, val: string) {
    setAdsetBudgets((prev) => prev.map((a, idx) => (idx === i ? { ...a, budget: val } : a)));
  }

  function buildAdsetBudgetPayload() {
    return adsetBudgets
      .filter((a) => a.budget.trim() && parseFloat(a.budget) > 0)
      .map((a) => ({ name: a.name, amount: parseFloat(a.budget), type: a.budget_type }));
  }

  async function handleSameAccountSubmit() {
    setSubmitting(true);
    setResults(null);
    try {
      const adset_budgets = buildAdsetBudgetPayload();
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
          ...(adset_budgets.length > 0 ? { adset_budgets } : {}),
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

  async function handleCsvDownload() {
    setCsvError('');
    setCsvDownloading(true);
    setCsvDownloaded(false);

    try {
      const adset_budgets = buildAdsetBudgetPayload();
      const res = await fetch(`/api/campaigns/${campaign.campaign_id}/export-csv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          names: copies.map((c) => c.name.trim()).filter(Boolean),
          ...(adset_budgets.length > 0 ? { adset_budgets: adset_budgets.map((b) => ({ ...b, currency })) } : {}),
        }),
      });

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const data = await res.json() as { error?: string };
          if (data.error) errMsg = data.error;
        } catch { /* ignore */ }
        setCsvError(errMsg);
        return;
      }

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'campaign-export.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      setCsvDownloaded(true);
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setCsvDownloading(false);
    }
  }

  const showAdsetBudgets = adsetBudgets.length > 0;

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

        {/* Same account vs Cross account toggle */}
        <div className="flex gap-2">
          <button
            onClick={() => { setDestAccountId(campaign.account_id); setResults(null); setCsvDownloaded(false); setCsvError(''); }}
            className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${!isCrossAccount ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
          >
            Same account
          </button>
          <button
            onClick={() => { setDestAccountId('__cross__'); setResults(null); setCsvDownloaded(false); setCsvError(''); }}
            className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${isCrossAccount ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
          >
            Cross account
          </button>
        </div>

        {/* Copy count */}
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

        {/* Campaign name rows */}
        <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
          {copies.map((copy, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                value={copy.name}
                onChange={(e) => updateCopy(i, 'name', e.target.value)}
                placeholder="Campaign name"
                className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {!isCrossAccount && hasBudget && (
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

        {/* Ad Set Budgets */}
        {loadingAdsets && (
          <p className="text-xs text-slate-400">Loading ad set budgets…</p>
        )}
        {showAdsetBudgets && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-600">
              Ad Set Budgets <span className="text-slate-400 font-normal">(applied to all copies · {currency})</span>
            </p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {adsetBudgets.map((adset, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="flex-1 text-xs text-slate-700 truncate" title={adset.name}>{adset.name}</span>
                  <span className="text-xs text-slate-400 shrink-0">{adset.budget_type === 'daily' ? 'daily' : 'lifetime'}</span>
                  <input
                    type="number"
                    min="0"
                    value={adset.budget}
                    onChange={(e) => updateAdsetBudget(i, e.target.value)}
                    placeholder={currency}
                    className="w-28 px-2.5 py-1 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Same-account results + footer */}
        {!isCrossAccount && (
          <>
            {results && (
              <div className="space-y-1">
                {results.map((r, i) => (
                  <div key={i} className={`flex flex-col gap-1 text-sm px-3 py-1.5 rounded-lg ${r.success ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
                    <div className="flex items-center gap-2">
                      <span>{r.success ? '✓' : '✗'}</span>
                      <span className="truncate font-medium">{r.name}</span>
                    </div>
                    {r.error && (
                      <div className="text-xs pl-5 space-y-0.5">
                        <p>{r.error}</p>
                        {/permission/i.test(r.error) && (
                          <p className="text-red-500">
                            Requires <strong>ads_management</strong> write permission + Advertiser/Admin role on this ad account. Check your Facebook token settings.
                          </p>
                        )}
                      </div>
                    )}
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
                {submitting ? 'Duplicating…' : 'Duplicate →'}
              </button>
            </div>
          </>
        )}

        {/* Cross-account footer */}
        {isCrossAccount && (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              One CSV file will be generated with all {copies.length} campaign{copies.length > 1 ? 's' : ''} inside. Import it in Facebook Ads Manager → Campaigns → Import Ads in Bulk.
            </div>
            {csvError && <p className="text-xs text-red-600">Error: {csvError}</p>}
            {csvDownloaded && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-800 flex items-center justify-between">
                <span className="font-medium">✓ CSV downloaded</span>
                <a href="https://business.facebook.com/adsmanager" target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline hover:text-indigo-800">Open Ads Manager ↗</a>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Close</button>
              <button
                onClick={handleCsvDownload}
                disabled={csvDownloading || copies.some((c) => !c.name.trim())}
                className="px-5 py-2 text-sm bg-slate-800 text-white rounded-lg hover:bg-slate-900 disabled:opacity-50 transition-colors"
              >
                {csvDownloading ? 'Generating…' : csvDownloaded ? '↓ Download again' : '↓ Download CSV'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
