'use client';

import { useEffect, useState } from 'react';
import type { TiktokAdvertiserAccount } from '@/lib/types';

interface TiktokConnectionCardProps {
  /** Guaranteed 'admin' or 'leader' by the parent — staff never renders this card. */
  role: 'admin' | 'leader';
}

type Banner = { type: 'success' | 'error'; message: string } | null;

const REASON_MESSAGES: Record<string, string> = {
  state: 'Connection request expired or was tampered with — please try again.',
  denied: 'TikTok authorization was cancelled or denied.',
  exchange: 'TikTok rejected the authorization code — please try again.',
  scope: 'TikTok did not grant the required permissions — check the app scopes in the Developer Portal.',
  save: 'Failed to save the TikTok connection — please try again.',
};

export default function TiktokConnectionCard({ role }: TiktokConnectionCardProps) {
  const [connected, setConnected] = useState(false);
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<TiktokAdvertiserAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [callbackUrl, setCallbackUrl] = useState('/api/tiktok/oauth/callback');

  useEffect(() => {
    setCallbackUrl(`${window.location.origin}/api/tiktok/oauth/callback`);
    const params = new URLSearchParams(window.location.search);
    const status = params.get('tiktok');
    if (status === 'connected') {
      if (params.get('reason') === 'sync_failed') {
        setBanner({ type: 'error', message: 'TikTok connected, but the advertiser account list failed to load — refresh this page to retry.' });
      } else {
        setBanner({ type: 'success', message: 'TikTok connected successfully.' });
      }
    } else if (status === 'error') {
      const reason = params.get('reason');
      setBanner({ type: 'error', message: (reason && REASON_MESSAGES[reason]) ?? 'Failed to connect TikTok.' });
    }
  }, []);

  useEffect(() => {
    fetch('/api/tiktok/accounts')
      .then((r) => r.json())
      .then((data) => {
        setConnected(!!data.connected);
        setConnectedAt(data.connected_at ?? null);
        setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function toggleAccount(advertiserId: string, isSelected: boolean) {
    setAccounts((prev) => prev.map((a) => (a.advertiser_id === advertiserId ? { ...a, is_selected: isSelected } : a)));
    const res = await fetch('/api/tiktok/accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ advertiser_id: advertiserId, is_selected: isSelected }),
    });
    if (!res.ok) {
      setAccounts((prev) => prev.map((a) => (a.advertiser_id === advertiserId ? { ...a, is_selected: !isSelected } : a)));
    }
  }

  async function handleDisconnect() {
    const confirmed = window.confirm(
      'Disconnect TikTok? This removes the org-wide connection and every advertiser selection. ' +
      'The token stays valid at TikTok until it naturally expires — revoke it from TikTok Business Center if compromised.',
    );
    if (!confirmed) return;
    setDisconnecting(true);
    try {
      const res = await fetch('/api/tiktok/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect' }),
      });
      if (res.ok) {
        setConnected(false);
        setConnectedAt(null);
        setAccounts([]);
      }
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) return null;

  const statusBoxCls = connected
    ? 'bg-emerald-50 border-emerald-200'
    : 'bg-slate-50 border-slate-200';

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
      <div>
        <h2 className="font-semibold text-slate-900">TikTok Ads Connection</h2>
        <p className="text-xs text-slate-500 mt-1">
          Org-wide connection — one admin authorizes once, everyone shares the same advertiser accounts.
        </p>
      </div>

      {banner && (
        <p className={`text-sm ${banner.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>{banner.message}</p>
      )}

      <div className={`flex items-center justify-between p-3 border rounded-lg ${statusBoxCls}`}>
        <div className="flex items-center gap-2">
          <span className={connected ? 'text-emerald-600 text-sm' : 'text-slate-400 text-sm'}>{connected ? '✓' : '○'}</span>
          <span className={`text-sm font-medium ${connected ? 'text-emerald-800' : 'text-slate-600'}`}>
            {connected ? `Connected${connectedAt ? ` since ${new Date(connectedAt).toLocaleString()}` : ''}` : 'Not connected'}
          </span>
        </div>
        {role === 'admin' && (
          connected ? (
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          ) : (
            <a href="/api/tiktok/oauth/start" className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 transition-colors">
              Connect TikTok
            </a>
          )
        )}
      </div>

      {role === 'admin' && !connected && (
        <p className="text-xs text-slate-500">
          Callback URL <code className="bg-slate-100 text-slate-700 px-1 rounded">{callbackUrl}</code> must be whitelisted in the TikTok Developer Portal before connecting.
        </p>
      )}

      {accounts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">Select which advertiser accounts feed the TikTok dashboard tab.</p>
          <ul className="divide-y divide-slate-100">
            {accounts.map((a) => {
              const isUsd = a.currency === 'USD';
              return (
                <li key={a.advertiser_id} className="flex items-center gap-3 py-3">
                  <input
                    type="checkbox"
                    id={`tt-${a.advertiser_id}`}
                    checked={a.is_selected}
                    disabled={!isUsd}
                    title={!isUsd ? 'USD-only in Plan 1 — non-USD accounts cannot be selected' : undefined}
                    onChange={(e) => toggleAccount(a.advertiser_id, e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 bg-white disabled:opacity-40"
                  />
                  <label htmlFor={`tt-${a.advertiser_id}`} className="flex-1 min-w-0 cursor-pointer">
                    <span className="block text-sm font-medium text-slate-900 truncate">{a.name}</span>
                    <span className="block text-xs text-slate-400 font-mono">{a.advertiser_id}</span>
                  </label>
                  {!isUsd && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-700" title="USD-only in Plan 1">
                      {a.currency}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
