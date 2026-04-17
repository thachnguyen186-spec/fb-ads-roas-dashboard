# Phase 04 — Vercel Cron + Telegram Alerter

## Context Links
- Vercel Cron docs: https://vercel.com/docs/cron-jobs
- Telegram Bot API: https://core.telegram.org/bots/api#sendmessage
- Reusable: `lib/facebook/spending-limits.ts` (phase 02)
- Service client: `lib/supabase/server.ts` (`createServiceClient`)

## Overview
- **Priority:** P1 (independent of UI; can ship before phase 05/06)
- **Status:** completed
- **Description:** Vercel Cron (hourly) hits `GET /api/cron/check-spending-limits`. Route iterates every user with selected accounts, fetches FB spending data, fires Telegram for any account whose `remaining < alert_threshold` and `alert_sent=false`. Resets `alert_sent` when account recovers.

## Key Insights
- Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` header automatically when `CRON_SECRET` env exists. Cron route MUST validate this header.
- Hourly crons require **Vercel Pro**. Hobby plans are limited to once/day. (See unresolved Q in plan.md.)
- Single chat (one `TELEGRAM_CHAT_ID`) for all users → message text must include user email + account name to disambiguate.
- Set `alert_sent=true` BEFORE sending Telegram → if Telegram fails, accept the missed alert (better than infinite retries).
- Cron should never throw — wrap each user iteration in try/catch and log; one failing user must not skip the rest.

## Requirements
- `vercel.json` with hourly cron entry.
- `CRON_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` env vars (documented in `.env.example`).
- Telegram util that no-ops when env vars missing (so dev runs do not spam).
- Cron route loops users → for each user → fetch live → diff → update DB → send Telegram.

## Architecture
```
Vercel Cron (hourly)
       │ Authorization: Bearer ${CRON_SECRET}
       ▼
GET /api/cron/check-spending-limits
       │
       ├── Verify CRON_SECRET
       │
       ├── service.from('fb_ad_accounts')
       │     .select('account_id, name, currency, alert_threshold, alert_sent, user_id')
       │     .eq('is_selected', true)
       │     .not('alert_threshold', 'is', null)   ← skip accounts with no threshold
       │
       ├── Group by user_id → load tokens via profiles
       │
       └── For each user (independently, try/catch):
             ├── fetchSpendingLimits(token, account_ids)
             ├── For each account:
             │     remaining = live.remaining
             │     if remaining === null → skip (no cap)
             │     if remaining < threshold AND !alert_sent:
             │         service.update({ alert_sent: true }).eq(account_id).eq(user_id)
             │         sendTelegram(buildAlertMessage(...))
             │     else if remaining >= threshold AND alert_sent:
             │         service.update({ alert_sent: false }).eq(account_id).eq(user_id)
             └── Continue on error
```

## Related Code Files
**Create:**
- `vercel.json`
- `app/api/cron/check-spending-limits/route.ts`
- `lib/telegram/send.ts`
- `lib/spending-limits/alerts.ts` (pure logic — message builder + decision fn, isolates business rules from I/O for unit testability)
- `.env.example` (or update if exists)

**Modify:** none.

## Implementation Steps

### 1. `vercel.json`
```json
{
  "crons": [
    {
      "path": "/api/cron/check-spending-limits",
      "schedule": "0 * * * *"
    }
  ]
}
```

### 2. `lib/telegram/send.ts`
```typescript
/**
 * Sends a Telegram message via the Bot API.
 * No-op (returns false) when env vars missing — keeps dev/test from spamming.
 */
export async function sendTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('[telegram] missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID — skipping send');
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[telegram] send failed', res.status, body);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[telegram] send threw', err);
    return false;
  }
}
```

### 3. `lib/spending-limits/alerts.ts`
```typescript
/**
 * Pure functions used by the cron route — no I/O so they are easy to unit test.
 */
import type { SpendingLimitRow } from '@/lib/facebook/spending-limits';

export type AlertDecision =
  | { kind: 'fire'; reason: 'crossed_below' }
  | { kind: 'reset'; reason: 'recovered' }
  | { kind: 'noop' };

export function decideAlert(
  remaining: number | null,
  threshold: number | null,
  alertSent: boolean,
): AlertDecision {
  if (remaining === null || threshold === null) return { kind: 'noop' };
  if (remaining < threshold && !alertSent) return { kind: 'fire', reason: 'crossed_below' };
  if (remaining >= threshold && alertSent) return { kind: 'reset', reason: 'recovered' };
  return { kind: 'noop' };
}

export function buildAlertMessage(opts: {
  userEmail: string;
  account: SpendingLimitRow;
  threshold: number;
}): string {
  const { userEmail, account, threshold } = opts;
  // Currency unit handling: USD displayed as dollars (÷100), other currencies as-is.
  const display = (n: number) =>
    account.currency === 'USD' ? (n / 100).toFixed(2) : Math.round(n).toLocaleString();
  return [
    `*Spending Limit Alert*`,
    `User: ${userEmail}`,
    `Account: ${account.name} (${account.account_id})`,
    `Currency: ${account.currency}`,
    `Spend cap: ${display(account.spend_cap ?? 0)}`,
    `Spent: ${display(account.amount_spent)}`,
    `Remaining: ${display(account.remaining ?? 0)} (threshold ${display(threshold)})`,
  ].join('\n');
}
```

### 4. `app/api/cron/check-spending-limits/route.ts`
```typescript
/**
 * GET /api/cron/check-spending-limits
 * Hourly Vercel Cron — checks every user's selected accounts for spend-cap alerts.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}  (set by Vercel Cron automatically)
 */

import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import {
  fetchSpendingLimits,
  isSpendingLimitError,
} from '@/lib/facebook/spending-limits';
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
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${expected}`) return errorResponse('Forbidden', 403);

  const service = createServiceClient();

  // Pull all selected accounts WITH a threshold set (skip accounts with null threshold)
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

  // Group by user_id
  const byUser = new Map<string, DbAccount[]>();
  for (const a of accounts) {
    if (!byUser.has(a.user_id)) byUser.set(a.user_id, []);
    byUser.get(a.user_id)!.push(a);
  }

  // Load profiles + auth emails (admin.listUsers — same pattern as dashboard/page.tsx)
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
      console.warn(`[cron] skipping user ${userId}: no token`);
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
          // Set flag FIRST to prevent duplicate sends if subsequent code throws
          await service
            .from('fb_ad_accounts')
            .update({ alert_sent: true })
            .eq('account_id', acc.account_id)
            .eq('user_id', userId);
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
      console.error(`[cron] user ${userId} failed`, err);
      // continue with next user
    }
  }

  return Response.json({ checked, fired, reset });
}
```

### 5. `.env.example` additions
```dotenv
# Spending Limit Monitor
CRON_SECRET=replace-with-random-32-char-string
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

## Todo List
- [x] Create `vercel.json`
- [x] Create `lib/telegram/send.ts`
- [x] Create `lib/spending-limits/alerts.ts`
- [x] Create `app/api/cron/check-spending-limits/route.ts`
- [x] Add env vars to `.env.example` and to Vercel project settings
- [x] Confirm Vercel plan supports hourly crons (Pro). If Hobby → change schedule to `0 9 * * *` and document.
- [x] Manual test: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/check-spending-limits`
- [x] Telegram inbox check after triggering one threshold crossing

## Success Criteria
- `curl` without auth returns 403.
- `curl` with auth returns `{ checked, fired, reset }` JSON.
- Test account with `remaining < threshold` and `alert_sent=false` → Telegram message arrives once; DB shows `alert_sent=true`.
- Repeat call → no duplicate message.
- Raise threshold via PATCH (resets `alert_sent`) → next cron tick re-fires.
- One user with bad token does not break the others.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Vercel plan = Hobby (hourly cron disallowed) | Med | High | Document in plan.md unresolved Qs; fallback to daily or external scheduler |
| `service.auth.admin.listUsers` paginates beyond 200 | Low | Med | `perPage: 200` matches dashboard pattern; revisit if user count grows |
| Telegram API down | Low | Low | `sendTelegram` swallows errors and returns false; alert_sent already set → next cycle treats as alerted (acceptable miss) |
| Long cron run (many users × FB latency) exceeds Vercel function timeout | Med | Med | `fetchSpendingLimits` is parallel per user, sequential across users. Default 10s limit on Hobby, 60s on Pro. If exceeded, batch users or increase function `maxDuration` |
| Race with PATCH (user changes threshold while cron iterates) | Low | Low | Last write wins; one extra alert is acceptable |

## Security Considerations
- `CRON_SECRET` in env, never committed.
- Service client used (bypasses RLS) — justified because the route is system-driven.
- Telegram token in env only.
- `Authorization` header check is strict equality (no timing-safe compare needed at this scale, but safe to upgrade to `crypto.timingSafeEqual` later).

## Next Steps
- Phase 05 (UI) is independent and can run in parallel with this phase.
