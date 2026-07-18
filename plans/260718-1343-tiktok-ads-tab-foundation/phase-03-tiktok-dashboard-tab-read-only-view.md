# Phase 3 — TikTok Dashboard Tab: Read-Only View + Adjust Revenue

## Context Links

- Plan overview: [plan.md](./plan.md)
- Depends on: [Phase 1](./phase-01-tiktok-api-client-and-database-schema.md) (types/client/merge), [Phase 2](./phase-02-oauth-connect-flow-and-settings-ui.md) (real data)
- Mirror sources: `app/dashboard/page.tsx`, `app/dashboard/components/campaign-hub.tsx`, `app/dashboard/components/campaign-table.tsx`, `app/dashboard/components/filter-bar.tsx`, `app/api/campaigns/route.ts`
- Research: [TikTok Control + Reporting](../reports/researcher-260718-0920-tiktok-api-auth-control.md) (§2–3)

## Overview

- **Priority:** P1
- **Status:** Complete (2026-07-18)
- **Estimate:** ~5h
- **Scope:** Tab switcher wrapping `/dashboard` (FB) and new `/dashboard/tiktok`; TikTok server page + client hub with a manual "Fetch Data" button; campaign table + filter bar; campaigns API route merging spend + Adjust `?partner=tiktok` revenue. Read-only (control parity is Phase 4).

## Key Insights

- **Independent data loading is structural:** separate Next.js routes → Next.js mounts only the active route's component tree, so FB data never loads on the TikTok tab and vice versa. No shared client state, no accidental co-fetch. (Decision #4.)
- `campaign-hub.tsx` is 848 lines (already far over the 200-line guide) — do NOT extend it. New TikTok logic lives in new files under `app/dashboard/tiktok/components/`.
- TikTok is API-only from day one — **no CSV fallback** (unlike FB's `adjust-csv-upload.tsx`). Simpler hub: "Fetch Data" button → parallel fetch campaigns + Adjust revenue → merge → render.
- Reuse `computeRoas`/`computeProfit`/`computeProfitAmount`/`formatRoas`/`roasColorClass`/`formatProfit` from `lib/adjust/merge.ts` (generic).
- Filter concepts (name/spend/budget/roas/status) are platform-agnostic. **Evaluate reusing `app/dashboard/components/filter-bar.tsx` directly** — its props take generic strings + `accountOptions: [id,name][]`; only the `appOptions`/app multi-select is FB-flavored (TikTok has no app-name dimension here). If the app multi-select can be omitted via empty `appOptions`, reuse as-is; else create a slim `tiktok-filter-bar.tsx` without the app selector. Planner leans **reuse if `appOptions=[]` cleanly hides it**, else fork.
- > 🔴 **Red Team Fix (2026-07-18) — read-access role decision:** the red team flagged that this page has no role check, meaning any authenticated `staff` user can view org-wide TikTok spend/revenue. Decision: this is **intentional, not an oversight** — `staff` need visibility into campaign performance to do their job (same as they see their own FB campaigns today), and the actual risk (control mutations, OAuth reconnection) is separately role-gated in Phase 2 (admin-only connect) and Phase 4 (admin+leader control). Document this explicitly here so it isn't re-flagged as a bug later: **read = all authenticated users; write = admin/leader (Phase 4); connect/reconnect = admin only (Phase 2).**
- > 🔴 **Red Team Fix (2026-07-18) — concurrency & token hoisting:** Phase 1's Risk Assessment requires "sequential-per-account or small concurrency" for the 429 risk, but this phase's original fetch design fanned out fully in parallel with no cap, AND called `getValidAccessToken()` once per advertiser inside the fan-out — both fixed below (Requirements, Architecture, Steps).
- > 🔴 **Red Team Fix (2026-07-18) — reporting lag reality:** research §3.3 says TikTok reporting has a 24-48h lag and "today's data incomplete" — this is a materially bigger gap than FB's near-real-time "partial" spend, and same-day TikTok spend may render as $0 for most/all of the operating day. The hub's empty/loading states (Requirements, Steps) must handle this as an expected common case, not an edge case, and should surface yesterday's full-day numbers as a secondary reference point so users aren't looking at a blank "today" column with no context.

## Requirements

### Functional
- `app/dashboard/layout.tsx` — tab switcher ("Facebook | TikTok" pills via `next/link`, active-route styling) wrapping both dashboard pages.
- `app/dashboard/tiktok/page.tsx` — server component: load connection status + selected advertisers (service client), pass as props. Redirect `/login` if no user (mirror FB page).
- `app/dashboard/tiktok/components/tiktok-campaign-hub.tsx` — client: "Fetch Data" button, loading/error/empty states, merged table, filter bar. No CSV.
- `app/dashboard/tiktok/components/tiktok-campaign-table.tsx` — merged campaign rows (name, status, budget, spend, roas, profit, impressions, clicks, cpc), sortable, row selection (selection wired but actions land in Phase 4).
- `app/dashboard/tiktok/components/tiktok-filter-bar.tsx` — ONLY if `filter-bar.tsx` can't be reused cleanly.
- `GET /api/tiktok/campaigns` — 🔴 fetch `getValidAccessToken()` **once**, then fetch campaigns + spend for all selected advertisers with **bounded concurrency** (e.g. 2-3 at a time, not full `Promise.all`); merge spend; return `TiktokCampaignRow[]` (Adjust merge happens client-side, mirroring FB hub which merges Adjust in the browser).

### Non-functional
- Files < 200 lines each. Hub may approach the limit — split table/filter/format helpers into their own files.
- No FB imports in TikTok components (independence).

## Architecture

### Route tree
```
app/dashboard/
  layout.tsx            (NEW — tab switcher: Facebook | TikTok)
  page.tsx              (existing FB — unchanged)
  components/…          (existing FB — unchanged)
  tiktok/
    page.tsx            (NEW — server: connection + selected advertisers)
    components/
      tiktok-campaign-hub.tsx    (NEW — client orchestrator)
      tiktok-campaign-table.tsx  (NEW)
      tiktok-filter-bar.tsx      (NEW — only if reuse rejected)
```

### Fetch/merge data flow (client hub)
```
[user] Fetch Data
  → GET /api/tiktok/campaigns
       server: token = getValidAccessToken()          🔴 ONCE, before the fan-out (Red Team Fix)
               for each selected advertiser (bounded concurrency, e.g. 2-3 at a time — 🔴 not unbounded parallel):
                 fetchCampaigns(advId, token)  +  fetchTodaySpend(advId, CAMPAIGN, token)
                 merge spend into rows
       → TiktokCampaignRow[]   (spend filled)
  → GET /api/adjust/revenue?partner=tiktok   → AdjustRow[]
  → build adjustCohortMap / adjustAllRevMap by campaign_id
  → mergeTiktokCampaigns(rows, {}, cohortMap, allRevMap)   🔴 USD-only by construction (Phase 2 blocks non-USD selection, Validation Session 1 Q1) — computes ROAS/Profit directly on spend
  → MergedTiktokCampaign[]  → filter → sort → table
```

### Independence guarantee
- FB tab (`/dashboard`) and TikTok tab (`/dashboard/tiktok`) are sibling routes under one layout. Navigating unmounts the other's hub → its fetches/state are gone. No cross-platform fetching possible.

## Related Code Files

### Create
- `app/dashboard/layout.tsx` — tab switcher (server or client; `usePathname` for active state if client).
- `app/dashboard/tiktok/page.tsx` — server component loading status + selected advertisers.
- `app/dashboard/tiktok/components/tiktok-campaign-hub.tsx` — client orchestrator.
- `app/dashboard/tiktok/components/tiktok-campaign-table.tsx` — table.
- `app/dashboard/tiktok/components/tiktok-filter-bar.tsx` — conditional (see Key Insights).
- `app/api/tiktok/campaigns/route.ts` — GET campaigns+spend merged, per selected advertiser, parallel.

### Modify
- None required to FB files. (`app/api/adjust/revenue/route.ts` already accepts `?partner=` from Phase 1 — hub just calls it with `?partner=tiktok`.)

### Delete
- None.

## Implementation Steps

1. **`layout.tsx`** — render a header strip with two `next/link` pills to `/dashboard` and `/dashboard/tiktok`; active pill styled (use `usePathname()` in a small client sub-component or compare in a client wrapper). Render `{children}` below. Keep minimal; do not fetch data here (independence). Ensure it does NOT force either page to be dynamic in a way that co-loads data.
2. **`tiktok/page.tsx`** — mirror `app/dashboard/page.tsx`: `createClient()` auth (redirect `/login` if none); `createServiceClient()` to read `tiktok_connection` (connected?) + `tiktok_advertiser_accounts where is_selected=true`. Compute `hasTiktokConnection`, `hasAdjustToken` (same env check as FB page). Pass `selectedAdvertisers`, `hasTiktokConnection`, `hasAdjustToken`, `userEmail` to `<TiktokCampaignHub/>`.
3. **`api/tiktok/campaigns/route.ts`** — mirror `app/api/campaigns/route.ts`: auth check; read selected advertisers (service client); if none → 400 "No TikTok advertiser accounts selected. Connect in Settings."; 🔴 call `getValidAccessToken()` **once** (catch `TIKTOK_NOT_CONNECTED`/`TIKTOK_RECONNECT_REQUIRED` → 400/409 with clear message, NOT 502) and reuse that token for every advertiser below. For advertisers, use 🔴 **bounded concurrency** (simple chunking, e.g. process 2-3 advertisers at a time in a loop of `Promise.all` batches — no external dependency needed) rather than a single unbounded `Promise.all`: `fetchCampaigns` + `fetchTodaySpend(CAMPAIGN)` per advertiser; overlay spend into rows. Return `{campaigns}`. Wrap TikTok errors → 502 with message (reconnect errors → 409).
4. **`tiktok-campaign-hub.tsx`** — state: phase (`idle|loading|results|error`), rawCampaigns, adjust maps, filters, sort, selectedIds. On "Fetch Data": `Promise.all([GET /api/tiktok/campaigns, GET /api/adjust/revenue?partner=tiktok])`; build maps by `campaign_id`; `mergeTiktokCampaigns`; set results. Render empty state when not connected / no advertisers with a link to Settings. Reuse merge/format helpers from `lib/adjust/merge.ts`. 🔴 All rows are USD by construction (Phase 2 blocks non-USD advertiser selection) — no per-row currency badge needed; the merge layer's defensive currency check is not expected to fire. 🔴 If today's TikTok spend total is $0 across all rows (expected given the 24-48h reporting lag — confirmed via Validation Session 1 Q3, keep today's column as the primary view with this note rather than defaulting to yesterday), show an inline note ("TikTok spend data typically lags 24-48h — today's figures may be incomplete") rather than presenting it as a normal zero.
5. **`tiktok-campaign-table.tsx`** — mirror `campaign-table.tsx` columns adapted to `MergedTiktokCampaign` (no app_name/cpi columns; keep name/status/budget/budget_mode/spend/roas/profit%/profit/impressions/clicks/cpc). Sortable headers; checkbox selection (`selectedIds` lifted to hub for Phase 4). Currency display simple (native decimal — no VND conversion).
6. **Filter bar decision** — attempt to render existing `FilterBar` with `appOptions={[]}` and `accountOptions` = advertiser `[id,name]`. If the app multi-select or FB-specific copy shows awkwardly, create `tiktok-filter-bar.tsx` (drop app selector; keep name/status/roas/spend/budget/account). Record the choice in a code comment.
7. **Loading/error/empty UX** — "not connected" → prompt admin to connect in Settings; "no selected advertisers" → prompt to select; API 409 (reconnect) → "TikTok connection expired — reconnect in Settings"; note the 24–48h reporting lag as inline helper text near spend column.
8. **Compile** — typecheck/build; click through both tabs to confirm independent mount/unmount.

## Todo List

- [x] `app/dashboard/layout.tsx` tab switcher (active-route styling)
- [x] `app/dashboard/tiktok/page.tsx` (server: connection + selected advertisers)
- [x] `app/api/tiktok/campaigns/route.ts` (🔴 token fetched once, bounded-concurrency per advertiser)
- [x] `tiktok-campaign-hub.tsx` (Fetch Data, merge Adjust `?partner=tiktok`, 🔴 reporting-lag inline note)
- [x] `tiktok-campaign-table.tsx` (sortable, selectable rows)
- [x] Reuse `FilterBar` OR create `tiktok-filter-bar.tsx` (documented decision)
- [x] Empty/error/reconnect states + reporting-lag helper text
- [x] Typecheck/build; verify tab independence (no cross-fetch)

## Success Criteria

- ✓ `/dashboard` and `/dashboard/tiktok` both render under a shared tab switcher; active tab highlighted.
- ✓ Switching to TikTok tab does NOT trigger any FB fetch (verified — independent routes, no shared state); switching back does not hold TikTok data.
- ✓ "Fetch Data" loads merged campaigns with spend (from Reporting) + ROAS/Profit (from Adjust `?partner=tiktok`).
- ✓ Not-connected / no-advertiser / reconnect states render clear guidance (no raw 500/502).
- ✓ 🔴 A `GET /api/tiktok/campaigns` request with 2+ selected advertisers issues exactly one `getValidAccessToken()` call (token fetched once at line 47, reused throughout batched loop).
- ✓ 🔴 No non-USD advertiser rows ever reach the table (Phase 2 enforces USD-only selection, merge layer has defensive check).
- ✓ No new file exceeds 200 lines (max 181); no FB module imported by TikTok components (grep verified).

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Reused `FilterBar` too FB-coupled → awkward UI | Medium | Low | Fallback to slim `tiktok-filter-bar.tsx`; decision documented |
| Adjust returns zero TikTok rows (wrong partner string from Phase 1) | Medium | High | Depends on Phase 1 verification; surface "0 Adjust matches" hint to catch early |
| Reporting UTC-today vs Adjust Bangkok-today drift | Medium | **High** (🔴 was Medium — same bug class already cost a fix cycle for FB; see Phase 1) | Depends on Phase 1's tz-param verification; if unresolvable, inline "spend delayed 24–48h" note is mandatory UI copy, not optional |
| 🔴 Today's TikTok spend renders as $0 for most/all of the day (reporting lag), read as "no spend" rather than "lag" | Medium | High | Inline lag note is a required element, not a nice-to-have; consider showing yesterday's full-day total alongside |
| Hub file > 200 lines | Medium | Low | Split table/filter/helpers into separate files |
| Layout accidentally makes both pages fetch (shared parent state) | Low | High | Keep layout data-free; each page owns its own fetch |
| Multi-advertiser fan-out hits 429 | ~~Low~~ **Medium without the fix** | Medium | 🔴 Bounded concurrency + single token fetch now a required implementation detail (Step 3), not deferred |

## Security Considerations

- `api/tiktok/campaigns` requires authenticated user; tokens fetched server-side via `getValidAccessToken()` — never sent to browser.
- Advertiser list read via service client (RLS-protected table); page passes only display-safe fields as props.
- No secret or token in any client component or network response.

## Next Steps

- Phase 4 wires selection → action bar (pause/enable/budget) and adds the ad-group flat view, reusing the table's `selectedIds`.
