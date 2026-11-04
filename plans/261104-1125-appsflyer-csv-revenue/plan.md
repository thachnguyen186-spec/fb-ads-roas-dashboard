---
title: "AppsFlyer CSV revenue (replace Adjust)"
description: "Import AppsFlyer 'App performance by Ad ID' CSV on FB and TikTok dashboards; remove Adjust."
status: in-progress
priority: P1
created: 2026-11-04
---

# AppsFlyer CSV revenue

AppsFlyer has no API access, only CSV exports. Export = today's figures up to export time (ignore the file-name date range).

## Locked decisions (user)
- One revenue column ("Revenue activity days") feeds Revenue, ROAS, %Profit and Profit.
- Per person, per session: parsed in the browser, never stored.
- Remove Adjust from both dashboards (API fetch, CSV upload, `/api/adjust/revenue`, Adjust env usage).
- Revenue only (installs ignored).

## Findings
- File: 4 columns `Ad ID, App, Revenue activity days appsflyer, Total attributions appsflyer`; one file mixes media sources: TikTok ads (16-digit `187…`), FB ads (18-digit `120…`), other networks, `None` rows.
- Revenue is per **ad**; dashboards are per campaign/ad set → map ad → campaign via platform API.
- TikTok `/ad/get` + `filtering.ad_ids` per advertiser: verified live, 257/257 mapped.
- FB: all stored tokens expired (17 Oct) — not live-verified. Use insights `level=ad`, fields `ad_id,adset_id,campaign_id`, last 7 days incl. today, per selected account.

## Done (shared)
- `lib/appsflyer/appsflyer-csv-parser.ts` — tested on the real export (324 ads, $77.05, 3 `None` skipped, ids exact).
- `lib/appsflyer/appsflyer-revenue-rows.ts` — `toRevenueRows(adRows, placements)` → existing `AdjustRow[]`.
- `app/dashboard/components/appsflyer-csv-upload.tsx` — shared drop zone.

## Phases (parallel, disjoint files)
| # | Scope | Status |
|---|-------|--------|
| A | TikTok: `/api/tiktok/ad-map` + hub/fetch-panel integration; delete `lib/tiktok/fetch-adjust-revenue.ts` | implemented, reviewed |
| B | FB: `/api/campaigns/ad-map` + campaign-hub step 1; remove Adjust API route/client/CSV upload + `hasAdjustToken` | implemented, reviewed |

## Review (2026-11-04)
Report: `plans/reports/code-reviewer-261104-1211-appsflyer-csv-revenue.md` (8/10, no Critical). Next:
1. FB live check: are deleted/archived ads in `level=ad` insights? Add `ad.effective_status` / `ad.id IN` filtering.
2. FB: load campaigns even when ad-map fails (`allSettled`).
3. FB: seq guards in `useAppsflyerRevenue` + `handleAnalyze`.
4. FB: block snapshot save while mapping/error/warnings.
5. TikTok: cache placements across refetches; detect Excel-corrupted ad IDs.

## Gate
`npx tsc --noEmit`, eslint on touched files, code review, commit only this feature (page-scheduler WIP stays uncommitted).
