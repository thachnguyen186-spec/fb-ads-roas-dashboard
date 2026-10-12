---
title: "TikTok dashboard parity with Facebook"
description: "Bulk campaign budget, snapshots, app filter, and Adjust revenue fix on the TikTok dashboard."
status: in-progress
priority: P1
created: 2026-10-12
---

# TikTok dashboard parity

User-reported gaps on /dashboard/tiktok vs the FB dashboard.

## Findings
- Budget: only via bottom action bar with exactly ONE campaign selected. No multi-select budget edit (FB has `adset-bulk-budget-modal.tsx` for ad sets). `BUDGET_MODE_INFINITE` campaigns have no campaign budget (budget lives on ad groups).
- Snapshots: FB only (`campaign_snapshots`, `/api/snapshots`, `snapshot-toolbar.tsx`). No platform column.
- App filter: FB derives app per campaign from Adjust rows (`aggregateAppByCampaignId`) + `appNameFilter`. TikTok hub doesn't.
- Adjust revenue shows "—" / "0 matched": verified data is fine (436/445 Adjust TikTok campaign ids match TikTok API, 99.9% revenue; partner_name "TikTok for Business"). Adjust CSV call takes ~16s locally; `/api/adjust/revenue` has no `maxDuration` and the TikTok hub silently drops a failed revenue response. Likely Vercel function timeout. Confirm via Vercel logs.

## Phases
| # | Phase | Owner files | Status |
|---|-------|-------------|--------|
| A | Bulk campaign budget (multi-select, FB adset-bulk parity; skip INFINITE with notice; per-item results) | `app/dashboard/tiktok/components/tiktok-action-bar.tsx`, new `tiktok-bulk-budget-modal.tsx` | pending |
| B1 | Adjust fix: `maxDuration = 60` on revenue route, surface Adjust errors in TikTok hub (banner, campaigns still shown) | `app/api/adjust/revenue/route.ts`, hub | pending |
| B2 | App filter (Adjust app per campaign, multi-select like FB) | hub, header/filter usage, campaign table | pending |
| B3 | Snapshots for TikTok (`platform` column; `/api/snapshots?platform=tiktok`; reuse toolbar; compare columns) | `app/api/snapshots/**`, hub, campaign table, results panel, `lib/types.ts` | pending |

## SQL (user runs once, idempotent) — in `supabase/schema.sql` after snapshots policy
`campaign_snapshots.platform text not null default 'facebook'` + check (facebook|tiktok) + index (user_id, platform, created_at desc).

## Gate
`npx tsc --noEmit`, `npm run lint`, files < 200 lines, code review, then commit (TikTok files only — page-scheduler WIP stays uncommitted).
