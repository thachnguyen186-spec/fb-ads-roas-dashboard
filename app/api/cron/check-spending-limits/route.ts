/**
 * GET /api/cron/check-spending-limits
 * Hourly Vercel Cron — checks every user's selected accounts for spend-cap alerts.
 * Sends Telegram message to the configured group when remaining < threshold.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}  (set by Vercel Cron automatically)
 * Requires Vercel Pro for hourly schedule (Hobby = daily only).
 */

import { timingSafeEqual } from 'crypto';
import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { fetchSpendingLimits, isSpendingLimitError } from '@/lib/facebook/spending-limits';
import { decideAlert, buildAlertMessage } from '@/lib/spending-limits/alerts';
import { sendTelegram } from '@/lib/telegram/send';

interface DbAccount {
  account_id: string;
  user_id: string;
  name: string;
  currency: string;
  alert_threshold: number;
  alert_sent: boolean;
}

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return errorResponse('CRON_SECRET not configured', 500);
  const auth = request.headers.get('authorization') ?? '';
  // Timing-safe comparison prevents byte-by-byte oracle attacks on the secret
  const actualBuf = Buffer.from(auth);
  const wantBuf = Buffer.from(`Bearer ${expected}`);
  const valid = actualBuf.length === wantBuf.length && timingSafeEqual(actualBuf, wantBuf);
  if (!valid) return errorResponse('Forbidden', 403);

  const service = createServiceClient();

  // Only fetch accounts that have a threshold configured (skip null-threshold rows)
  const { data: rows, error } = await service
    .from('fb_ad_accounts')
    .select('account_id, user_id, name, currency, alert_threshold, alert_sent')
    .eq('is_selected', true)
    .not('alert_threshold', 'is', null);

  if (error) return errorResponse(error.message, 500);

  const accounts = (rows ?? []) as DbAccount[];
  if (accounts.length === 0) {
    return Response.json({ checked: 0, fired: 0, reset: 0 });
  }

  // Group accounts by user_id for batched token lookup
  const byUser = new Map<string, DbAccount[]>();
  for (const a of accounts) {
    if (!byUser.has(a.user_id)) byUser.set(a.user_id, []);
    byUser.get(a.user_id)!.push(a);
  }

  const userIds = [...byUser.keys()];
  const [profilesRes, authRes] = await Promise.all([
    service.from('profiles').select('id, fb_access_token').in('id', userIds),
    service.auth.admin.listUsers({ perPage: 200 }),
  ]);

  const tokenMap = new Map(
    (profilesRes.data ?? []).map((p) => [p.id as string, p.fb_access_token as string | null]),
  );
  const emailMap = new Map(
    (authRes.data?.users ?? []).map((u) => [u.id, u.email ?? u.id]),
  );

  let fired = 0;
  let reset = 0;
  let checked = 0;

  for (const [userId, userAccounts] of byUser) {
    const token = tokenMap.get(userId);
    if (!token) {
      console.warn(`[cron:spending] skipping user ${userId}: no FB token`);
      continue;
    }
    try {
      const live = await fetchSpendingLimits(token, userAccounts.map((a) => a.account_id));
      const liveMap = new Map(live.map((r) => [r.account_id, r]));

      for (const acc of userAccounts) {
        checked++;
        const l = liveMap.get(acc.account_id);
        if (!l || isSpendingLimitError(l)) continue;

        const decision = decideAlert(l.remaining, acc.alert_threshold, acc.alert_sent);

        if (decision.kind === 'fire') {
          // Set flag BEFORE sending to prevent duplicate alerts if Telegram call throws
          const { error: updateErr } = await service
            .from('fb_ad_accounts')
            .update({ alert_sent: true })
            .eq('account_id', acc.account_id)
            .eq('user_id', userId);
          if (updateErr) {
            console.error(`[cron:spending] failed to set alert_sent for ${acc.account_id}`, updateErr);
            continue; // skip send — dedup flag not set; will retry next cycle
          }
          await sendTelegram(
            buildAlertMessage({
              userEmail: emailMap.get(userId) ?? userId,
              account: l,
              threshold: acc.alert_threshold,
            }),
          );
          fired++;
        } else if (decision.kind === 'reset') {
          await service
            .from('fb_ad_accounts')
            .update({ alert_sent: false })
            .eq('account_id', acc.account_id)
            .eq('user_id', userId);
          reset++;
        }
      }
    } catch (err) {
      // Per-user isolation: one failing user does not skip the rest
      console.error(`[cron:spending] user ${userId} failed`, err);
    }
  }

  return Response.json({ checked, fired, reset });
}
