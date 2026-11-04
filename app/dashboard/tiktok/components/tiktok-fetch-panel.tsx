'use client';

import Link from 'next/link';
import AppsflyerCsvUpload from '@/app/dashboard/components/appsflyer-csv-upload';
import { formatUsd } from '@/lib/utils';
import { countLabel, type AppsflyerParseResult } from '@/lib/appsflyer/appsflyer-csv-parser';
import type { useTiktokAppsflyerRevenue } from './use-tiktok-appsflyer-revenue';

interface Props {
  /** Viewing another user's accounts (leader/admin picker). */
  viewingEmail: string | null;
  /** Whether the viewed (or own) user has a TikTok connection. */
  connected: boolean;
  advertiserCount: number;
  /** Show the idle/fetch card (hidden once results are displayed). */
  showFetchCard: boolean;
  loading: boolean;
  errorMsg: string;
  onFetch: () => void;
  /** AppsFlyer revenue state; the upload is optional and works before or after Fetch. */
  appsflyer: ReturnType<typeof useTiktokAppsflyerRevenue>;
  hasCampaigns: boolean;
  onAppsflyerReady: (result: AppsflyerParseResult | null) => void;
}

const NOTICE = 'p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800';
const CARD = 'bg-white border border-slate-200 rounded-xl p-6 space-y-4 max-w-lg';

function AppsflyerStatus({ af, hasCampaigns, showFetchCard }: { af: Props['appsflyer']; hasCampaigns: boolean; showFetchCard: boolean }) {
  if (af.error) {
    return (
      <p role="alert" className="text-xs text-red-600">
        AppsFlyer matching failed: {af.error}. Revenue, ROAS and profit are not shown — upload the file again to retry.
      </p>
    );
  }
  if (af.mapping) return <p className="text-xs text-slate-500">AppsFlyer: matching ads to campaigns…</p>;
  if (af.file && af.match && hasCampaigns) {
    return (
      <p className="text-xs text-slate-600">
        AppsFlyer: {af.match.matchedAds} of {countLabel(af.file.rows.length, af.file.level)} matched to these campaigns · {formatUsd(af.match.matchedRevenue)} revenue
      </p>
    );
  }
  if (af.file && !hasCampaigns) return <p className="text-xs text-slate-500">AppsFlyer revenue is applied after Fetch.</p>;
  if (!af.file && !showFetchCard) {
    return <p className="text-xs text-amber-700">No AppsFlyer file — revenue, ROAS and profit are not shown.</p>;
  }
  return null;
}

export default function TiktokFetchPanel({
  viewingEmail, connected, advertiserCount, showFetchCard, loading, errorMsg, onFetch,
  appsflyer, hasCampaigns, onAppsflyerReady,
}: Props) {
  const canFetch = connected && advertiserCount > 0;
  return (
    <>
      {!connected && !viewingEmail && (
        <div className={NOTICE}>
          TikTok is not connected.{' '}
          <Link href="/settings" className="font-medium underline">Go to Settings</Link> to connect your TikTok account.
        </div>
      )}
      {connected && advertiserCount === 0 && (
        <div className={NOTICE}>
          {viewingEmail ? `${viewingEmail} has no TikTok advertiser accounts selected.` : (
            <>
              No TikTok advertiser accounts selected.{' '}
              <Link href="/settings" className="font-medium underline">Go to Settings</Link> to select accounts.
            </>
          )}
        </div>
      )}
      {viewingEmail && (
        <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-700">
          Viewing {viewingEmail} — read-only. Controls work on accounts you connected yourself.
        </div>
      )}

      {/* One stable container in both phases so the upload keeps its file summary after Fetch. */}
      <div className={showFetchCard ? CARD : 'max-w-lg space-y-1'}>
        {showFetchCard && canFetch && (
          <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-700">
            Will fetch campaigns from <strong>{advertiserCount}</strong> advertiser account{advertiserCount !== 1 ? 's' : ''}.
            {' '}Revenue, ROAS and profit come from the optional AppsFlyer CSV below.
          </div>
        )}
        <AppsflyerCsvUpload onReady={onAppsflyerReady} />
        <AppsflyerStatus af={appsflyer} hasCampaigns={hasCampaigns} showFetchCard={showFetchCard} />
        {showFetchCard && (
          <button
            onClick={onFetch}
            disabled={!canFetch || loading}
            className="w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Fetching…' : 'Fetch Data'}
          </button>
        )}
        {showFetchCard && errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}
      </div>
    </>
  );
}
