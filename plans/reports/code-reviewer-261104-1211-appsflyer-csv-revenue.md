# Code Review: AppsFlyer CSV revenue (replace Adjust)

Status: DONE_WITH_CONCERNS. Score 8/10. No code changes made.

## Scope
- New: `lib/appsflyer/*`, `lib/facebook/ad-placements.ts`, `lib/tiktok/ad-placements.ts`, `app/api/campaigns/ad-map/route.ts`, `app/api/tiktok/ad-map/route.ts`, `app/dashboard/components/{appsflyer-csv-upload,appsflyer-revenue-status}.tsx`, `use-appsflyer-revenue.ts`, `app/dashboard/tiktok/components/use-tiktok-appsflyer-revenue.ts`.
- Modified: FB `campaign-hub.tsx`, `campaign-table.tsx`, `adset-flat-view.tsx`, `page.tsx`; TikTok hub, fetch panel, results panel, snapshot section, `page.tsx`; `lib/adjust/csv-parser.ts`, `lib/types.ts`, `app/layout.tsx`, `.env.local.example`. Adjust route, client, CSV upload and TikTok fetcher are deleted.
- Around 900 LOC. Page-scheduler WIP was ignored.
- Gates: `npx tsc --noEmit` exits 0. eslint on the touched files shows 0 errors and 3 warnings, all in code this feature did not change.

## Overall assessment
Security is sound. Both ad-map routes copy the authz of their campaigns-route siblings exactly: `getUser`, then `canViewAs` only when `viewAs` differs from the requester, then the target user's token and selected accounts or advertisers loaded through the service client. The TikTok route also intersects the requested `advertiser_ids` with the target's selected accounts. Tokens never appear in responses or logs, and error and warning strings carry only FB or TikTok error text.

IDs stay strings end to end. The parser keeps `dynamicTyping` off and checks `^\d+$`. The routes use string regexes. Graph and TikTok both return string IDs. Nothing calls `Number`, `parseInt` or `+id`.

Revenue is not double-counted. The parser sums duplicate ad IDs, `toRevenueRows` emits one row per ad, and every upload, replace or refetch rebuilds the maps from scratch rather than adding to them.

Nothing calls `/api/adjust/revenue` any more. The only leftover reference is a comment.

The main risks are on the FB side and come from the design, which could not be checked live:
- ads the insights call cannot see lose their revenue without any warning;
- a failed mapping takes the whole dashboard down with it;
- the FB hook has no guard against stale responses, unlike the TikTok hook.

## Critical
None.

## High
1. **FB insights may silently drop the revenue of deleted or archived ads, and of ads idle for more than 7 days** (`lib/facebook/ad-placements.ts:85-98`). The TikTok side found live that an ad deleted today still earns AppsFlyer revenue today, and it added `primary_status: STATUS_ALL` for that reason. The FB call uses `level=ad` with no `filtering`. From memory, Graph omits DELETED and ARCHIVED ads from level breakdowns unless you filter on `ad.effective_status`, but I could not confirm this in the docs I fetched. "Revenue activity days" also includes revenue from users acquired earlier, so an ad in a campaign that spends today but that has not delivered in 7 days goes unmapped. Either case undercounts ROAS and Profit, and the warning strip says nothing.
   - **Fix:** once a valid token exists, test with an ad you know was deleted today. If it is missing, add `filtering: JSON.stringify([{ field: 'ad.effective_status', operator: 'IN', value: ['ACTIVE','PAUSED','DELETED','ARCHIVED','CAMPAIGN_PAUSED','ADSET_PAUSED','IN_PROCESS','WITH_ISSUES'] }])`.
   - **Also consider:** `{field:'ad.id',operator:'IN',value:[chunk of ≤50 ids]}`. It cuts the 60×500-row paging down to the wanted ads. That avoids FB's "reduce the amount of data" error on large accounts, which today turns into a per-account warning and partial revenue.

## Medium
2. **On FB, a failed mapping hides the campaigns** (`campaign-hub.tsx:309-313`). `Promise.all([campaigns, applyRevenue])` rejects when ad-map returns non-2xx: a platform timeout (no `maxDuration` is set and accounts are paged sequentially), a 5xx, or a 400. The dashboard then shows nothing. The old Adjust CSV path could not fail this way, and the TikTok hub loads campaigns first and maps revenue in the background. **Fix:** use `Promise.allSettled`. Merge with `emptyMaps()` when mapping rejects and let `AppsflyerRevenueStatus` show `appsflyer.error`. That component already renders the error.
3. **The FB hook has no guard against stale responses** (`use-appsflyer-revenue.ts:72-101`, `campaign-hub.tsx:276-279, 288-295, 795-800`).
   - **(a)** Switching staff while Analyze is in flight runs `reset()`. The old `applyRevenue` then resolves and writes `parsed`, the maps and the summary back, and `handleAnalyze` sets the old user's campaigns to `results` under the new staff label. The campaign half of this race existed before, but now it reaches the revenue state too.
   - **(b)** A replace-file mapping and an ActionBar `onActionComplete` → `handleAnalyze` running together can finish in either order. When they do, the hook's maps (used by ad sets, flat view and the App filter) come from the new file while `mergedCampaigns` comes from the old one. `mapping` is also cleared by whichever call finishes first.
   - **Fix:** copy the TikTok hook. Add a `seq` ref that `applyRevenue` and `reset` bump, and return or throw a "stale" sentinel when the sequence has moved on. In the hub, add an `analyzeSeq` ref that `handleStartOver` bumps and that is checked after the await, as `fetchSeq` is on TikTok.
4. **FB snapshot save is not blocked when revenue is partial** (`campaign-hub.tsx:701-709`). The TikTok hub blocks saving through `revenueMissing`. FB only reaches results with mapped revenue, but `fetchAdPlacements` turns per-account failures (expired token, paging cut short, FB data-size errors) into `warnings` on a 200. A snapshot taken then stores partial revenue, and later deltas look wrong. Saving also stays allowed while a replace mapping is running. **Fix:** compute `const revenueIncomplete = appsflyer.mapping || !!appsflyer.error || appsflyer.warnings.length > 0`, then reuse the TikTok pattern: a no-op `onSave` plus the amber notice. At minimum, block on `mapping`.
5. **The TikTok mapping is re-run in full on every refetch, and any single error drops all revenue** (`use-tiktok-appsflyer-revenue.ts:41-66`, `lib/tiktok/ad-placements.ts:61-79`). Every campaign action calls `handleFetchData`, which calls `af.apply` and then `/api/tiktok/ad-map`. Each advertiser gets ceil(N/100) `/ad/get` calls. The pending set never empties, because the FB and other-network IDs in the shared file never resolve, so every advertiser is always scanned. With many advertisers this costs seconds per action and risks TikTok rate limits. A single 40100 rate-limit error throws, and the user then loses all revenue and the ability to save snapshots. **Fix:** cache placements on the client per `(file, viewAs)`, as the FB hook does, and on refetch send only the IDs not yet resolved, or skip the request when the advertiser set is unchanged.
6. **IDs corrupted by Excel are labelled "unattributed"** (`appsflyer-csv-parser.ts:61`, `appsflyer-csv-upload.tsx:77`). If someone opens the export in Excel and saves it, 16–18 digit IDs become `1.20213E+17` or lose their last digits. The `^\d+$` check then drops them into `skippedRows` as "unattributed", and the revenue disappears with a misleading message. Truncated IDs that still match `^\d+$` just fail to map. **Fix:** count non-numeric IDs other than `None` or empty, and anything matching `/^\d(\.\d+)?E\+\d+$/i`, separately. When that count is above 0, show "Ad IDs look reformatted (Excel?) — re-export the CSV from AppsFlyer".

## Low
7. `appsflyer-csv-parser.ts:28-31`: `parseFloat("1,234.56")` returns 1. Strip `,` and `$` before parsing, in case an export or re-save uses thousand separators.
8. `app/api/campaigns/ad-map/route.ts:29-33`: the array is regex-checked and deduped before the 5000 cap. Check `ad_ids.length > MAX_AD_IDS` first, as the TikTok route does.
9. The FB status line says "X of N ads matched · $Y". N includes TikTok and other-network ads, and $Y includes campaigns that are not displayed, because TikTok scopes to fetched campaigns and FB does not. Scope it to `rawFbCampaigns` IDs or reword it ("FB ads matched").
10. Replacing the file on FB after a failed mapping leaves the drop zone showing the new file name while the revenue still comes from the old file. On TikTok, a failed parse (`onReady(null)`) clears revenue that was already applied, while FB keeps it. The two behave differently.
11. `tiktok-snapshot-section.tsx`: while revenue is missing, `onSave` is a silent no-op, but the Save button stays enabled. This pattern predates the feature. A `disabled` prop on `SnapshotToolbar` would be clearer.
12. `lib/tiktok/reporting.ts:6-8`: the comment still refers to the deleted `lib/adjust/api-client.ts` and to Adjust's Bangkok "today".
13. Commit hygiene: the untracked `Kie AI API ChatGPT.txt` in the repo root is unrelated and may hold a key, so keep it out of the feature commit.

## Positive observations
- The authz and scoping pattern is copied exactly, and the TikTok route also intersects advertisers with the target's selected accounts.
- ID precision is handled deliberately, with comments at the risky points (`dynamicTyping: false`).
- The TikTok hook uses a seq counter and a file ref, which handle uploads before, during and after a fetch correctly. Merging ad groups at render time means a new file updates ad groups that are already loaded.
- FB per-account failures become readable warnings, and an expired token is reported once.
- The FB placement cache keyed on `(parsed identity, viewAs)` avoids remapping after a campaign action.

## Recommended actions (priority order)
1. Verify on FB live whether deleted ads show up in insights. Add `ad.effective_status` filtering, and preferably `ad.id IN` chunks (#1).
2. Make FB campaigns load even when mapping fails, using `allSettled` (#2).
3. Add seq guards to `useAppsflyerRevenue` and to `handleAnalyze` (#3).
4. Block FB snapshot saving while mapping is running, has errored or has warnings (#4).
5. Cache TikTok placements across refetches (#5) and detect corrupted IDs (#6).

## Metrics
- Type coverage: strict TypeScript, with no `any` in the new code.
- Tests: there are no automated tests. The parser was checked by hand against the real export (per the plan).
- Lint: 0 errors, 3 warnings, all in code this feature did not change.

## Unresolved questions
- Does Graph `/{act}/insights?level=ad` with no `filtering` return DELETED and ARCHIVED ads? The answer decides whether #1 is a real bug or only a hardening step.
- What is the Vercel tier and function timeout? With no `maxDuration`, a large account's FB ad-map, or a TikTok ad-map across many advertisers, may hit the limit. With #2 in place that only drops revenue instead of the dashboard.
- Should AppsFlyer revenue be scoped to displayed campaigns on FB, as it is on TikTok? This only affects the status-line numbers (#9).
