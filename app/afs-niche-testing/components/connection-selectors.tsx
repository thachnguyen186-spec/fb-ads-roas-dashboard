'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { FbAdAccount, FbPage, FbPixel, SpecialAdCategory } from '@/lib/types';

export interface ConnectionDefaults {
  ad_account_id: string;
  page_id: string;
  page_name: string;
  pixel_id: string;
  countries: string[];
  special_ad_category: SpecialAdCategory;
  /** Raw user input in major units (e.g. "10.00"). Converted to minor units by the parent, never here. */
  daily_budget_major: string;
  /** Selected account's currency — carried up so the parent can do the one conversion at intake. */
  currency: string;
}

export const DEFAULT_CONNECTION: ConnectionDefaults = {
  ad_account_id: '',
  page_id: '',
  page_name: '',
  pixel_id: '',
  countries: [],
  special_ad_category: 'NONE',
  daily_budget_major: '',
  currency: 'USD',
};

const COMMON_COUNTRIES = [
  'US', 'CA', 'GB', 'AU', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'SE', 'NO', 'DK',
  'FI', 'IE', 'PT', 'PL', 'AT', 'CH', 'NZ', 'SG', 'MY', 'PH', 'TH', 'VN',
];

const CATEGORY_OPTIONS: { value: SpecialAdCategory; label: string }[] = [
  { value: 'NONE', label: 'None' }, { value: 'EMPLOYMENT', label: 'Employment' },
  { value: 'HOUSING', label: 'Housing' }, { value: 'CREDIT', label: 'Credit' },
  { value: 'ISSUES_ELECTIONS_POLITICS', label: 'Issues, Elections or Politics' },
];

interface Props {
  value: ConnectionDefaults;
  onChange: (value: ConnectionDefaults) => void;
}

export default function ConnectionSelectors({ value, onChange }: Props) {
  const [adAccounts, setAdAccounts] = useState<FbAdAccount[]>([]);
  const [pages, setPages] = useState<FbPage[]>([]);
  const [pixels, setPixels] = useState<FbPixel[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newCountry, setNewCountry] = useState('');

  async function loadAssets(accountId?: string) {
    setLoading(true);
    setError('');
    try {
      const url = new URL('/api/afs-niche-testing/fb-assets', window.location.origin);
      if (accountId) url.searchParams.set('accountId', accountId);
      const res = await fetch(url.toString());
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load Facebook assets');
      setAdAccounts(json.ad_accounts ?? []);
      setPages(json.pages ?? []);
      setPixels(json.pixels ?? []);
      setWarnings(json.warnings ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Facebook assets');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAssets();
  }, []);

  function handleAccountChange(accountId: string) {
    const account = adAccounts.find((a) => a.account_id === accountId);
    onChange({ ...value, ad_account_id: accountId, pixel_id: '', currency: account?.currency || 'USD' });
    if (accountId) loadAssets(accountId);
  }

  function handlePageChange(pageId: string) {
    const page = pages.find((p) => p.id === pageId);
    onChange({ ...value, page_id: pageId, page_name: page?.name ?? '' });
  }

  function toggleCountry(code: string) {
    const has = value.countries.includes(code);
    onChange({ ...value, countries: has ? value.countries.filter((c) => c !== code) : [...value.countries, code] });
  }

  function addCountry() {
    const code = newCountry.trim().toUpperCase();
    if (code.length === 2 && !value.countries.includes(code)) {
      onChange({ ...value, countries: [...value.countries, code] });
    }
    setNewCountry('');
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
      <h2 className="font-semibold text-slate-900">Facebook Connection Defaults</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-slate-400">Loading Facebook assets…</p>}

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Ad Account</label>
        <select value={value.ad_account_id} onChange={(e) => handleAccountChange(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">Select an ad account…</option>
          {adAccounts.map((a) => (
            <option key={a.account_id} value={a.account_id}>{a.name} ({a.account_id}){a.currency ? ` · ${a.currency}` : ''}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Page</label>
        {pages.length === 0 && !loading ? (
          <p className="text-xs text-amber-600">
            Add <code className="bg-slate-100 px-1 rounded">pages_show_list</code> to your launch token in{' '}
            <Link href="/settings" className="text-indigo-600 underline hover:text-indigo-700">Settings</Link>.
          </p>
        ) : (
          <select value={value.page_id} onChange={(e) => handlePageChange(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">Select a Page…</option>
            {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Pixel (optional)</label>
        <select value={value.pixel_id} onChange={(e) => onChange({ ...value, pixel_id: e.target.value })} className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">No pixel</option>
          {pixels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {warnings.length > 0 && (
        <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 space-y-0.5">
          {warnings.map((w) => <p key={w}>{w}</p>)}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Countries</label>
        <div className="flex flex-wrap gap-2 mb-2">
          {COMMON_COUNTRIES.map((code) => (
            <label key={code} className="flex items-center gap-1 px-2 py-1 border border-slate-200 rounded-full text-xs cursor-pointer">
              <input type="checkbox" checked={value.countries.includes(code)} onChange={() => toggleCountry(code)} className="h-3 w-3 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
              {code}
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newCountry}
            onChange={(e) => setNewCountry(e.target.value)}
            placeholder="Add ISO code (e.g. MX)"
            className="px-2 py-1 border border-slate-300 rounded-lg text-xs w-40"
          />
          <button type="button" onClick={addCountry} className="px-3 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs hover:bg-slate-200">Add</button>
        </div>
        {value.countries.length > 0 && <p className="text-xs text-slate-500 mt-1">Selected: {value.countries.join(', ')}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Default daily budget ({value.currency})</label>
        <input
          type="number" min="0" step="0.01" placeholder="10.00"
          value={value.daily_budget_major}
          onChange={(e) => onChange({ ...value, daily_budget_major: e.target.value })}
          className="w-40 px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <p className="text-xs text-slate-500 mt-1">Entered in major units (e.g. 10.00 = $10/day); applied to every topic.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Special Ad Category</label>
        <select
          value={value.special_ad_category}
          onChange={(e) => onChange({ ...value, special_ad_category: e.target.value as SpecialAdCategory })}
          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <p className="text-xs text-slate-500 mt-1">Jobs, housing, and credit niches must select the matching category — Facebook policy requires it.</p>
      </div>
    </div>
  );
}
