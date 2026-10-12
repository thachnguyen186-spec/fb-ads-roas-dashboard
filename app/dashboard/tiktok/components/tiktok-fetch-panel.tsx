'use client';

import Link from 'next/link';

interface Props {
  /** Viewing another user's accounts (leader/admin picker). */
  viewingEmail: string | null;
  /** Whether the viewed (or own) user has a TikTok connection. */
  connected: boolean;
  advertiserCount: number;
  hasAdjustToken: boolean;
  /** Show the idle/fetch card (hidden once results are displayed). */
  showFetchCard: boolean;
  loading: boolean;
  errorMsg: string;
  onFetch: () => void;
}

const NOTICE = 'p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800';

export default function TiktokFetchPanel({
  viewingEmail, connected, advertiserCount, hasAdjustToken, showFetchCard, loading, errorMsg, onFetch,
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

      {showFetchCard && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 max-w-lg">
          {canFetch && (
            <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-700">
              Will fetch campaigns from <strong>{advertiserCount}</strong> advertiser account{advertiserCount !== 1 ? 's' : ''}.
              {!hasAdjustToken && ' Adjust revenue is not configured, so ROAS/Profit will be unavailable.'}
            </div>
          )}
          <button
            onClick={onFetch}
            disabled={!canFetch || loading}
            className="w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Fetching…' : 'Fetch Data'}
          </button>
          {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}
        </div>
      )}
    </>
  );
}
