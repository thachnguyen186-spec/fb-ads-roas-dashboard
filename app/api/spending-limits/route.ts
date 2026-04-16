/**
 * GET /api/spending-limits
 * Fetches spend_cap / amount_spent / remaining for ALL of the user's
 * selected ad accounts, merged with the stored alert_threshold.
 */

import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import {
  fetchSpendingLimits,
  isSpendingLimitError,
  type SpendingLimitResult,
} from '@/lib/facebook/spending-limits';

interface AccountRow {
  account_id: string;
  name: string;
  currency: string;
  alert_threshold: number | null;
  alert_sent: boolean;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const service = createServiceClient();
  const [profileRes, accountsRes] = await Promise.all([
    service.from('profiles').select('fb_access_token').eq('id', user.id).single(),
    service
      .from('fb_ad_accounts')
      .select('account_id, name, currency, alert_threshold, alert_sent')
      .eq('user_id', user.id)
      .eq('is_selected', true),
  ]);

  if (!profileRes.data) return errorResponse('Profile not found', 404);
  const { fb_access_token } = profileRes.data as { fb_access_token: string | null };
  if (!fb_access_token) return errorResponse('Facebook access token not configured.', 400);

  const stored = (accountsRes.data ?? []) as AccountRow[];
  if (stored.length === 0) return errorResponse('No ad accounts selected. Go to Settings.', 400);

  try {
    const live: SpendingLimitResult[] = await fetchSpendingLimits(
      fb_access_token,
      stored.map((a) => a.account_id),
    );
    const liveMap = new Map(live.map((r) => [r.account_id, r]));
    const accounts = stored.map((s) => {
      const l = liveMap.get(s.account_id);
      if (!l) {
        return { ...s, error: 'No FB response', spend_cap: null, amount_spent: 0, remaining: null, percent_used: null };
      }
      if (isSpendingLimitError(l)) {
        return { ...s, error: l.error, spend_cap: null, amount_spent: 0, remaining: null, percent_used: null };
      }
      return {
        ...s,
        name: l.name || s.name,
        currency: l.currency || s.currency,
        spend_cap: l.spend_cap,
        amount_spent: l.amount_spent,
        remaining: l.remaining,
        percent_used: l.percent_used,
      };
    });
    return Response.json({ accounts, fetched_at: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch spending limits';
    const isTokenErr = /token|session|oauth|expired/i.test(message);
    return errorResponse(
      isTokenErr
        ? `Facebook token error: ${message}. Go to Settings and refresh your access token.`
        : message,
      502,
    );
  }
}
