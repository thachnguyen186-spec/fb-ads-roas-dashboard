/** Client-side fetch of TikTok-partner Adjust revenue. Never throws: failures are returned as `error` so
 * the dashboard can still show campaigns with a visible warning instead of silently treating them as zero revenue. */

import type { AdjustRow } from '@/lib/types';

export interface AdjustRevenueResult {
  rows: AdjustRow[];
  /** Human-readable failure reason; null on success. */
  error: string | null;
}

export async function fetchTiktokAdjustRevenue(): Promise<AdjustRevenueResult> {
  try {
    const res = await fetch('/api/adjust/revenue?partner=tiktok');
    // Platform timeouts return non-JSON (HTML/text) bodies — fall back to the HTTP status.
    const data = await res.json().catch(() => null) as { rows?: AdjustRow[]; error?: string } | null;
    if (!res.ok) return { rows: [], error: data?.error ?? `HTTP ${res.status}` };
    return { rows: data?.rows ?? [], error: null };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : 'Network error' };
  }
}
