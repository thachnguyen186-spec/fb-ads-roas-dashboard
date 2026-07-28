# Phase 06 — UI: Page + Hub + Filter/Table/CSV/Grouping + Tool Hub Card

## Context Links
- Server-page + client-hub template: `app/spending-limit-monitor/page.tsx`, `app/spending-limit-monitor/components/spending-limit-hub.tsx`
- Client-side filter/sort architecture: `app/dashboard/components/campaign-hub.tsx`
- Date preset UI + custom range: `app/dashboard/components/export-spend-modal.tsx` (`PRESETS`, custom since/until)
- CSV style to mirror: `lib/spend-export.ts` (manual string builder, `csvCell`, `\r\n`)
- Tool Hub: `app/tools/page.tsx` (`TOOLS` array, `Tool` interface)
- Routes consumed: `GET /api/accounting-export` (Phase 04), `GET/PATCH /api/account-owners` (Phase 05)
- Types: `lib/types.ts` (`AccountingExportRow`, `AccountOwnerEntry`)

## Overview
- **Priority:** P1 (depends on 04 + 05)
- **Status:** completed
- **Description:** Server page `app/accounting-export/page.tsx` (**[Fix #1]** redirect-if-unauthenticated AND redirect-if-staff → `/tools`) rendering client `AccountingExportHub`, split into filter-bar, results-table, and grouping-manager sub-components (each < 200 lines). Plus `lib/accounting/export-csv.ts` and a Tool Hub card.

## Key Insights
- Mirror `spending-limit-monitor/page.tsx` server flow (auth → render client hub). All data fetching is client-side.
- **[Red Team Fix #1]** The page server component checks role and redirects staff to `/tools` (defense in depth — the routes already 403 staff, but staff shouldn't see the page shell either).
- Full visible dataset is small enough to filter/sort/group **in-memory** (same architecture as `campaign-hub.tsx`) — the ONLY server-side params are date range + platform. Account/name/campaign/owner search all run client-side over the fetched `AccountingExportRow[]`.
- CSV built by hand (manual string builder + UTF-8 BOM + Blob download), reusing `lib/spend-export.ts`'s `csvCell`/`\r\n` style. **No new npm dep** (YAGNI).
- **[Red Team Fix #2]** CSV formula-injection guard: `csvCell` must prefix a single quote `'` to any value starting with `= + - @` or tab BEFORE the existing quote-on-comma/quote/newline logic. An `owner_label` like `=HYPERLINK(...)` must not become a live formula in the accountant's Excel.
- **Currency never summed across currencies.** Group subtotals: sum per currency; a group spanning multiple currencies shows one subtotal line per currency, each labelled.
- **[Red Team Fix #14]** Owner-label edits patch the matching `rawRows` locally on successful PATCH (not just the grouping list) — the `account_id`+`platform` key is known client-side, so an immediate CSV download reflects the new label. Removes the stale-value contradiction with plan Success Criteria #6.
- **[Red Team Fix #3]** Target column shows a small info tooltip for website targets: "one observed destination; a campaign may run multiple destinations." Never presented as authoritative.
- **[Red Team Fix #13]** Date-range picker carries a caveat tooltip: "Facebook dates use each account's own reporting timezone; TikTok dates are UTC — spend near range boundaries may shift by up to a day."
- **[Red Team Fix #5b/#12/#15]** Render `coverage` (e.g. "Showing spend for 12 of 12 users"), a distinct red banner when `leg_aborted` is set (systemic failure ≠ routine warnings), and the truncation warning if rows were capped at 5,000.
- Split for the < 200-line rule: hub orchestrates state; filter-bar, table, grouping-manager are presentational/leaf components.

## Requirements
- **Filter bar:** date range (PRESETS + custom since/until, from export-spend-modal), platform toggle (Facebook / TikTok / Both), account id/name text search, campaign name text search, owner/department dropdown (distinct `owner_label` from loaded rows), "Run export" button, "Group by owner" toggle.
- **Results table:** Platform | Account ID | Account Name | Owner/Department | Campaign Name | Currency | Spend | Target — client-side sort on any column, client-side filter over all text fields. **[Fix #3]** website Target cells carry an "observed destination" info tooltip.
- **Group-by-owner:** collapsible groups, per-group subtotal row(s) — one per currency (never cross-currency sum).
- **Warnings banner:** render `warnings[]` (non-fatal per-account failures). **[Fix #12]** render `leg_aborted` distinctly as a red "export aborted — try again shortly" banner. **[Fix #15]** surface the truncation warning. **[Fix #5b]** render `coverage` as a small persistent note.
- **[Fix #13]** date-picker caveat tooltip about FB-per-account-timezone vs TikTok-UTC boundaries.
- **CSV export:** `lib/accounting/export-csv.ts`; columns match the table; filename `accounting-export_{range}_{platform}.csv`.
- **Manage Groupings panel:** lists `GET /api/account-owners`; each row has an editable `owner_label` input, saved via `PATCH` on blur/Enter (optimistic + inline error).
- **Tool Hub card:** new entry in `TOOLS` — id `accounting-export`, name "Accounting Export", href `/accounting-export`, status `active`.

## Architecture
```
app/accounting-export/
  ├── page.tsx                                   [server, ~15 lines — auth → <AccountingExportHub/>]
  └── components/
        ├── accounting-export-hub.tsx            [client, ~180 lines]
        │     state: rawRows[], warnings[], loading, error, filters, groupBy, sort
        │     derived (useMemo): filteredRows, groupedRows (per-currency subtotals)
        │     handlers: runExport(), downloadCsv()
        │     renders: <ExportFilterBar/> + warnings + <ResultsTable/> + <GroupingManager/>
        ├── export-filter-bar.tsx                [client, ~150 lines] date/platform/search/group toggle
        ├── results-table.tsx                    [client, ~150 lines] sortable table + grouped subtotals
        └── grouping-manager.tsx                 [client, ~150 lines] GET list + inline PATCH per row
lib/accounting/export-csv.ts                     [pure, ~80 lines] buildAccountingCsv(rows, rangeLabel) + BOM download
app/tools/page.tsx                               [add one TOOLS entry]
```

Data flow:
```
runExport() → GET /api/accounting-export?since&until&datePreset&platform
  → setRawRows(rows), setWarnings(warnings), setCoverage(coverage), setLegAborted(leg_aborted)
filters/sort/groupBy change → useMemo recompute (no refetch)
downloadCsv() → buildAccountingCsv(filteredRows) → Blob([BOM+csv]) → <a download>
GroupingManager edit → PATCH /api/account-owners → on success:
  [Fix #14] patch matching rawRows (same account_id+platform) locally → immediate CSV freshness
  on failure: revert + inline error
```

## Related Code Files
**Create:**
- `app/accounting-export/page.tsx`
- `app/accounting-export/components/accounting-export-hub.tsx`
- `app/accounting-export/components/export-filter-bar.tsx`
- `app/accounting-export/components/results-table.tsx`
- `app/accounting-export/components/grouping-manager.tsx`
- `lib/accounting/export-csv.ts`

**Modify:**
- `app/tools/page.tsx` (add `TOOLS` entry)

## Implementation Steps

1. `app/accounting-export/page.tsx` (server) — mirror `spending-limit-monitor/page.tsx` + **[Fix #1]** role gate:
   ```typescript
   import { redirect } from 'next/navigation';
   import { createClient } from '@/lib/supabase/server';
   import { getUserRole } from '@/lib/auth-guards';
   import AccountingExportHub from './components/accounting-export-hub';

   export default async function AccountingExportPage() {
     const supabase = await createClient();
     const { data: { user } } = await supabase.auth.getUser();
     if (!user) redirect('/login');
     const role = (await getUserRole(user.id)) ?? 'staff';
     if (role !== 'admin' && role !== 'leader') redirect('/tools');  // [Fix #1] staff have no access
     return <AccountingExportHub userEmail={user.email ?? ''} role={role} />;
   }
   ```

2. `lib/accounting/export-csv.ts` (mirror `lib/spend-export.ts` style):
   - **[Fix #2]** `csvCell(val)` — FIRST neutralize formula injection: if `val`'s first char is one of `= + - @` or a tab, prefix a single quote `'`. THEN apply the existing quote-on-comma/quote/newline logic. Columns: `Platform, Account ID, Account Name, Owner/Department, Campaign Name, Currency, Spend, Target`.
   - `buildAccountingCsv(rows: AccountingExportRow[], rangeLabel: string): string` — header line + one row each; `spend` as-is (native, no conversion), no cross-currency total row (or per-currency total lines only).
   - `downloadAccountingCsv(rows, rangeLabel, platform)` — `new Blob(['﻿' + csv], { type: 'text/csv' })` → `<a>` download `accounting-export_{range}_{platform}.csv`.

3. `export-filter-bar.tsx` — `PRESETS` (copy from export-spend-modal), custom since/until inputs, platform `<select>` (facebook/tiktok/both), text inputs (account search, campaign search), owner `<select>` (distinct labels passed in as prop), "Run export" + "Group by owner" toggle. Emits filter state up via callbacks.

4. `results-table.tsx` — receives `rows` (already filtered) + `groupBy` + sort state. Flat mode: sortable columns. Grouped mode: iterate owner groups, render rows, then per-currency subtotal line(s). Formats spend with `Intl.NumberFormat` per row currency. **[Fix #3]** website Target cells render an info-icon tooltip ("one observed destination…").

5. `grouping-manager.tsx` — on mount `GET /api/account-owners`; render each `AccountOwnerEntry` with an inline editable `owner_label` input (reuse the `threshold-cell.tsx` blur/Enter/Esc pattern conceptually); `PATCH` on commit; optimistic update + inline error on failure. **[Fix #14]** on successful PATCH, call an `onOwnerChanged(account_id, platform, label)` prop so the hub patches matching `rawRows`.

6. `accounting-export-hub.tsx` — props `{ userEmail, role }`; owns `rawRows`, `warnings`, `coverage`, `legAborted`, `filters`, `groupBy`, `sort`; `useMemo` for `filteredRows`/`groupedRows`; `runExport()`/`downloadCsv()`/`onOwnerChanged()` handlers; header with back-link to `/tools`. **[Fix #5b]** render coverage note; **[Fix #12]** distinct red banner when `legAborted`; **[Fix #15]** truncation warning; **[Fix #13]** date-picker caveat tooltip. Keep < 200 lines by delegating rendering to the sub-components.

7. `app/tools/page.tsx` — add to `TOOLS`:
   ```typescript
   {
     id: 'accounting-export',
     name: 'Accounting Export',
     description: 'Export all FB + TikTok ad spend over any date range in original currency, grouped by person-in-charge. CSV-ready for accounting.',
     href: '/accounting-export',
     image: '',              // placeholder until an asset exists (ToolCard renders a fallback)
     status: 'active',
     badge: 'Live',
   }
   ```

8. Manual smoke: **[Fix #1]** staff → redirected from `/accounting-export` to `/tools`; run export across a past range for both platforms; filter/sort/group in-memory; per-currency subtotals correct; CSV opens in Excel with correct UTF-8 and **[Fix #2]** a `=…` owner label is neutralized (leading `'`); **[Fix #14]** owner edit updates loaded rows immediately + persists across reload; warnings banner shows on a broken account; **[Fix #12]** `leg_aborted` renders as a distinct red banner; **[Fix #5b]** coverage note visible for admin; **[Fix #3/#13]** target + date tooltips present.

## Todo List
- [x] Create `app/accounting-export/page.tsx` (**[Fix #1]** staff → redirect `/tools`)
- [x] Create `lib/accounting/export-csv.ts` (builder + BOM download + **[Fix #2]** formula-injection guard)
- [x] Create `export-filter-bar.tsx` (**[Fix #13]** date caveat), `results-table.tsx` (**[Fix #3]** target tooltip), `grouping-manager.tsx` (**[Fix #14]** `onOwnerChanged`)
- [x] Create `accounting-export-hub.tsx` (state + useMemo + handlers + **[Fix #5b/#12/#15]** coverage/abort/truncation banners + rawRows patch)
- [x] Add `accounting-export` entry to `TOOLS` in `app/tools/page.tsx`
- [x] `npx tsc --noEmit` + `npm run lint` pass
- [x] `npm run dev` → `/accounting-export`: staff-redirect, export, filter, sort, group, CSV+injection-guard, owner-edit immediate + persist, warnings, leg_aborted, coverage
- [x] Confirm no component file exceeds 200 lines (split further if needed)

## Success Criteria
- Card at `/tools` navigates to `/accounting-export`; **[Fix #1]** staff are redirected away.
- Export returns both platforms, native currency; filters/sort/group work without refetch.
- Group-by-owner shows per-currency subtotals; no cross-currency sum.
- CSV downloads, opens in Excel with correct encoding, columns match the table; **[Fix #2]** formula-prefixed labels are neutralized.
- **[Fix #14]** Owner label edited in Manage Groupings updates the loaded rows immediately, persists across reload, and appears in an immediate CSV download.
- `warnings[]` rendered as a non-blocking banner; **[Fix #12]** `leg_aborted` as a distinct red banner; **[Fix #15]** truncation surfaced; **[Fix #5b]** coverage note shown for admin.
- No component file > 200 lines.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Hub grows past 200 lines | Med | Low | Three leaf components already extracted; extract a `use-export-filters` hook if still large |
| Excel misreads UTF-8 without BOM | High | Med | Prepend `﻿` (proven in `lib/spend-export.ts`) |
| **[Fix #2]** Formula injection via `owner_label` in exported CSV | Med | High | `csvCell` prefixes `'` to values starting `= + - @`/tab before quoting |
| Cross-currency subtotal shown as one number | Med | Med | Group subtotal logic keys by currency; render one line per currency |
| **[Fix #14]** Edited owner label stale in an immediate CSV download | Low | Low | Patch matching `rawRows` on successful PATCH (contradiction removed) |
| **[Fix #15]** User unaware results were truncated at 5,000 rows | Low | Med | Truncation warning rendered in the banner area |
| Large result set slows in-memory filter | Low | Low | Dataset is small (same assumption as `campaign-hub.tsx`); `useMemo` guards recompute; 5,000-row ceiling bounds it |

## Security Considerations
- **[Fix #1]** Server `page.tsx` enforces login AND admin/leader role (redirects staff); all writes go through the auth-checked, role-gated PATCH route.
- No FB/TikTok token ever reaches the client (only aggregated rows).
- **[Fix #2]** Owner-label free text is neutralized against CSV/formula injection on export (`csvCell` guard); React default-escapes it in the DOM.

## Next Steps
- Feature complete. Post-launch: optional per-account image asset for the Tool Hub card; revisit pagination/chunking if admin-wide exports approach the function timeout (see plan Risk Register).
