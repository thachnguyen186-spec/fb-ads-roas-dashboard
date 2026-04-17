---
title: "Account Spending Limit Monitor"
description: "New tool that surfaces FB ad account spend_cap usage with per-account thresholds and Telegram alerts (manual refresh, hourly client poll, hourly Vercel Cron)."
status: completed
priority: P2
effort: 8h
branch: master
tags: [feature, fb-api, monitoring, telegram, cron]
created: 2026-04-16
completed: 2026-04-16
---

# Account Spending Limit Monitor

Lightweight monitoring tool that lists every selected FB ad account with `spend_cap`, `amount_spent`, `remaining`, `% used`. Per-account threshold drives Telegram alerts. Foreground refresh (manual + 1h interval) keeps the UI live; Vercel Cron runs the same check every hour even when the page is closed. Alert dedup column prevents spam.

## Architecture (one-shot view)

```
Browser ── GET /api/spending-limits ─┐
                                     ▼
                    fetchSpendingLimits(token, ids[])
                                     │
                          parallel /{act_id}?fields=...
                                     ▼
                              FB Graph API v21
                                     │
   { accounts: [{ account_id, name, currency, spend_cap, amount_spent, alert_threshold }] }

Vercel Cron (0 * * * *) ── GET /api/cron/check-spending-limits
       │  (CRON_SECRET header)
       ▼
   For every user with selected accounts:
       fetchSpendingLimits → diff against alert_threshold + alert_sent
       If trigger → sendTelegram() → set alert_sent=true
       If recovered → set alert_sent=false
```

## Phases

| # | Phase | Status | File |
|---|-------|--------|------|
| 01 | DB schema + types | completed | [phase-01-db-schema-types.md](./phase-01-db-schema-types.md) |
| 02 | FB API spending limits fetcher | completed | [phase-02-fb-api-spending-limits.md](./phase-02-fb-api-spending-limits.md) |
| 03 | API routes (GET list, PATCH threshold) | completed | [phase-03-api-routes.md](./phase-03-api-routes.md) |
| 04 | Vercel Cron + Telegram alerter | completed | [phase-04-vercel-cron-telegram.md](./phase-04-vercel-cron-telegram.md) |
| 05 | Tool UI (page + client component) | completed | [phase-05-tool-ui.md](./phase-05-tool-ui.md) |
| 06 | Tool Hub registration | completed | [phase-06-tool-hub-registration.md](./phase-06-tool-hub-registration.md) |

## Dependency Graph

```
01 ─┬─► 02 ─┬─► 03 ─┐
    │      │       ├─► 05 ─► 06
    └──────┴─► 04 ─┘
```
- 02 depends on 01 (types) but only soft (uses raw FB shape, not DB).
- 04 depends on 01 (alert_sent column), 02 (fetcher), and Telegram util — Telegram util lives in phase 04.
- 05 depends on 03 (routes consumed by client).
- 06 last (purely additive entry).

## File Ownership (no overlap between phases)

| Phase | Files created/edited |
|-------|----------------------|
| 01 | `supabase/schema.sql`, `lib/types.ts` |
| 02 | `lib/facebook/spending-limits.ts` |
| 03 | `app/api/spending-limits/route.ts`, `app/api/spending-limits/[accountId]/route.ts` |
| 04 | `vercel.json`, `app/api/cron/check-spending-limits/route.ts`, `lib/telegram/send.ts`, `lib/spending-limits/alerts.ts`, `.env.example` |
| 05 | `app/spending-limit-monitor/page.tsx`, `app/spending-limit-monitor/components/spending-limit-hub.tsx`, `app/spending-limit-monitor/components/threshold-cell.tsx` |
| 06 | `app/tools/page.tsx` (TOOLS array + image asset reference) |

No two phases edit the same file → safe for parallel execution after 01.

## Cross-cutting decisions

- **Currency unit:** FB returns `spend_cap` and `amount_spent` as strings in the account's smallest unit (USD cents, VND as-is). We store/compare as numeric in that same smallest unit; display layer divides USD by 100. `alert_threshold` is stored in the SAME unit and entered in the same unit for consistency.
- **Auth/data source mirroring dashboard:** server page loads `selectedAccounts` from DB (cheap), client component fetches live FB data via `/api/spending-limits` (matches campaigns flow).
- **Auto-refresh:** plain `setInterval(60 * 60 * 1000)` in `useEffect` with cleanup — no SWR/React Query (YAGNI).
- **Alert dedup:** single `alert_sent boolean` column (KISS). Edge: if user changes threshold from below→above current remaining, alert_sent should reset (handled in PATCH handler).
- **No `viewAs`:** scope: own accounts only for v1. Leader/admin see only their own ad accounts (revisit later if requested).

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| FB account has no `spend_cap` (unlimited) | High | Med | Treat `spend_cap === '0'` or missing as "no cap" → render `—` and skip alert |
| Token expires | Med | High | Same error shape as `/api/campaigns` (already-handled "token error" message). Cron logs and continues (per-user try/catch). |
| Telegram API rate limit (30 msg/sec to different users, 1 msg/sec same chat) | Low | Low | Single TELEGRAM_CHAT_ID; cron sends ≤ N alerts/hour where N = total selected accounts across all users → well below limit |
| Cron duplicates alert if request retried | Low | Med | `alert_sent` flip is set BEFORE Telegram send → if Telegram fails, log and leave `alert_sent` true (alternative would be retry-storm). Acceptable: missed alert > duplicate alert. |
| User changes threshold across crossing point | Med | Low | PATCH route resets `alert_sent` to false whenever threshold changes |
| Currency mismatch in user's mental model (VND vs USD cents) | Med | Med | UI label shows `Threshold ({currency})` and helper text "in account's native unit"; display divides USD by 100 for both stored values and threshold input |
| Vercel Cron disabled on Hobby plan | Med | High | Document in phase 04 that Vercel Pro is required for hourly crons (Hobby = daily only). If Hobby, fall back to client-only. |
| Race: client PATCH while cron is reading | Low | Low | Idempotent: cron reads → decides → writes alert_sent. Worst case = one alert delayed by 1h. Accept. |

## Backwards Compatibility

- New tool, no existing user impact.
- `fb_ad_accounts` gets two NEW nullable/defaulted columns → existing rows unaffected.
- No type signatures of `FbAdAccount` change (additions only).
- No existing API route touched.
- Tool Hub gets a new card → no existing card altered.

## Test Matrix

| Layer | What to verify | How |
|-------|---------------|-----|
| SQL migration | Columns exist after `alter table … add column if not exists` runs idempotently | Run twice in Supabase SQL editor |
| `fetchSpendingLimits` | Returns sane shape for 1 account; handles "no spend_cap"; parallel for N accounts | Manual call against test account |
| `GET /api/spending-limits` | 401 without auth; 400 if no token / no selected accounts; 200 with array | curl + dev session |
| `PATCH /api/spending-limits/[accountId]` | Saves threshold; resets `alert_sent`; rejects non-owned account | curl + dev session |
| Cron route | Rejects without `Authorization: Bearer ${CRON_SECRET}`; iterates all users; sends Telegram once per crossing | Manual hit + Telegram inbox check |
| UI | Table renders all selected accounts; refresh button updates `last updated`; auto-refresh fires after 1h (mock interval); inline edit saves on blur/enter; status badges color correctly | Manual smoke + browser devtools |
| End-to-end alert | Set threshold above current remaining → next cron tick fires Telegram; raise threshold above → `alert_sent` resets → next drop alerts again | Manual run with low-threshold test |

## Rollback

- **Per phase:** each phase's files are additive except 06 (tool hub array). To rollback: remove the new files; for 06, delete the new TOOLS entry; for 01, run `alter table public.fb_ad_accounts drop column if exists alert_threshold, drop column if exists alert_sent;` (only if no production data depends on it).
- **Cron:** delete the route file or remove the entry from `vercel.json`; redeploy.
- **Telegram blast risk:** if a misconfigured threshold causes spam, set `TELEGRAM_BOT_TOKEN=""` env to disable instantly (sender util short-circuits when missing).

## Success Criteria (measurable)

1. Tool card appears at `/tools` and navigates to `/spending-limit-monitor`.
2. Page lists every selected ad account with non-error rows for accounts that have `spend_cap`.
3. Manual refresh updates `lastUpdated` timestamp within 5s on healthy network.
4. Auto-refresh re-fires after 60 min (verifiable by countdown).
5. Inline threshold edit persists across page reload.
6. Setting a threshold above current `remaining` → Telegram message arrives within ≤ 1h (cron).
7. After Telegram sent, no duplicate within same crossing window.
8. After `remaining` rises above threshold then drops below again → Telegram fires once more.

## Unresolved Questions

1. **Vercel plan tier:** Is this project on Vercel Pro? Hourly crons require it. If Hobby, default cron schedule must be daily and we should document the gap (or replace cron with an external scheduler like cron-job.org hitting the same route).
2. **Multi-user Telegram:** Spec says one shared `TELEGRAM_CHAT_ID`. If multiple staff use the app, alerts from any user's accounts go to the same chat. Is the message content's `account_id` enough to disambiguate? (Phase 04 includes `user_email` in the message text to be safe.)
3. **Threshold unit clarity:** Stored unit = FB native (USD cents, VND units). UI input — should we accept dollars and convert internally for USD accounts, or accept native units only? **Default in plan: native units** (KISS, matches FB exactly). Confirm before phase 05 implementation.
4. **`amount_spent` reset cadence:** FB resets `amount_spent` when the account's `spend_cap` is changed or the billing cycle resets. Should `alert_sent` also reset on `amount_spent` decrease? **Default: yes — covered by the "remaining >= threshold → reset" branch.**
