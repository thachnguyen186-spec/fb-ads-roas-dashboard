# Phase 3: Dashboard Dual-Mode Fetch

## Context Links
- [CampaignHub component](../../app/dashboard/components/campaign-hub.tsx)
- [Dashboard page (server component)](../../app/dashboard/page.tsx)
- [AdjustCsvUpload component](../../app/dashboard/components/adjust-csv-upload.tsx)
- [Plan overview](./plan.md)
- [Phase 1 (dependency)](./phase-01-token-storage-settings.md)
- [Phase 2 (dependency)](./phase-02-adjust-api-client.md)

## Overview
- **Priority:** P1
- **Status:** Pending
- **Description:** Add "Fetch from Adjust API" as primary data source option in dashboard when token is configured. CSV upload becomes secondary fallback. Both paths produce identical state for the merge pipeline.

## Key Insights
- `handleAnalyze()` in campaign-hub.tsx is the convergence point — it calls `parseAdjustCsv()` then runs aggregation functions. API fetch must produce the same `AdjustRow[]` and feed the same aggregation chain.
- Current flow: CSV upload → `handleCsvReady()` → sets `csvFile` + `phase: 'csv_ready'` → user clicks Analyze → `handleAnalyze()` parses CSV + fetches FB campaigns
- New flow: API fetch button → call `/api/adjust/revenue` → get `AdjustRow[]` → run aggregation functions → fetch FB campaigns → merge → done
- `AdjustCsvUpload` component stays unchanged — just shown conditionally (secondary when API available)
- `hasAdjustToken` prop needed from server component (same pattern as `hasToken`)

## Requirements

### Functional
- Dashboard page passes `hasAdjustToken: boolean` prop to CampaignHub
- When `hasAdjustToken === true`:
  - Primary action: "Fetch today's data from Adjust API" button
  - Secondary: collapsible "or upload CSV manually" section with existing `AdjustCsvUpload`
- When `hasAdjustToken === false`:
  - Current behavior: CSV upload only (unchanged)
- API fetch produces same `AdjustRow[]` → same aggregation maps → same `handleAnalyze()` convergence
- Loading spinner during API fetch
- Error display with option to retry or fall back to CSV
- App filter: when API mode, show app filter dropdown AFTER fetching (list apps from returned rows)

### Non-Functional
- No changes to merge pipeline, table rendering, or any downstream component
- Existing CSV flow must remain fully functional
- No flicker or layout shift when switching modes

## Architecture

```
DashboardPage (server component)
  └─ reads profiles.adjust_api_token → hasAdjustToken: boolean
     └─ CampaignHub({ hasToken, hasAdjustToken, selectedAccounts, ... })

CampaignHub (client)
  ├─ hasAdjustToken? → show "Fetch from API" (primary) + CSV upload (secondary)
  │   └─ handleFetchFromApi()
  │       ├─ GET /api/adjust/revenue?app={filter}
  │       ├─ response.rows → AdjustRow[]
  │       ├─ Run aggregation functions (same as handleAnalyze)
  │       ├─ Store adjustRows in state (for handleAnalyze to use instead of CSV)
  │       └─ Set phase → 'csv_ready' (Analyze button appears)
  │
  └─ handleAnalyze()
      ├─ IF adjustRows in state → use them (skip parseAdjustCsv)
      ├─ ELSE IF csvFile → parseAdjustCsv(csvFile, appFilter)
      └─ Continue with FB fetch + merge (unchanged)
```

### State Changes in CampaignHub

New state:
```typescript
const [adjustRows, setAdjustRows] = useState<AdjustRow[] | null>(null);  // API-fetched rows
const [apiFetching, setApiFetching] = useState(false);
const [apiFetchError, setApiFetchError] = useState('');
```

Modified `handleAnalyze()`:
```typescript
// Replace: const adjustRows = await parseAdjustCsv(csvFile, appFilter);
// With:
const rows = adjustRows ?? (csvFile ? await parseAdjustCsv(csvFile, appFilter) : []);
```

This is the minimal change — `adjustRows` state takes priority over CSV parsing.

## Related Code Files

### Files to Modify
| File | Change |
|------|--------|
| `app/dashboard/page.tsx` | Read `adjust_api_token` from profiles, pass `hasAdjustToken` prop |
| `app/dashboard/components/campaign-hub.tsx` | Add `hasAdjustToken` prop, API fetch button, `handleFetchFromApi()`, modify `handleAnalyze()` |

### Files NOT Modified
| File | Reason |
|------|--------|
| `app/dashboard/components/adjust-csv-upload.tsx` | Unchanged, just shown conditionally |
| `lib/adjust/csv-parser.ts` | Pipeline untouched |
| `lib/adjust/merge.ts` | Pipeline untouched |
| `lib/types.ts` | No new types needed |

## Implementation Steps

### 1. Update Dashboard Page (`app/dashboard/page.tsx`)

In the profiles select query (line 15), add `adjust_api_token`:
```typescript
service.from('profiles').select('fb_access_token, adjust_api_token').eq('id', user.id).single(),
```

After `hasToken` (line 24), add:
```typescript
const hasAdjustToken = !!(profileRes.data as { adjust_api_token?: string | null } | null)?.adjust_api_token;
```

Pass to CampaignHub (line 73):
```typescript
<CampaignHub
  hasToken={hasToken}
  hasAdjustToken={hasAdjustToken}
  selectedAccounts={selectedAccounts}
  userRole={userRole}
  staffList={staffList}
/>
```

### 2. Update CampaignHub Props and State (`campaign-hub.tsx`)

Update Props interface (~line 24):
```typescript
interface Props {
  hasToken: boolean;
  hasAdjustToken: boolean;  // NEW
  selectedAccounts: FbAdAccount[];
  userRole: UserRole;
  staffList: StaffMember[];
}
```

Add import for AdjustRow type (line 9):
```typescript
import type { AdjustRow, AdSetRow, CampaignRow, ... } from '@/lib/types';
```

Add state (~after line 42):
```typescript
const [adjustRows, setAdjustRows] = useState<AdjustRow[] | null>(null);
const [apiFetching, setApiFetching] = useState(false);
const [apiFetchError, setApiFetchError] = useState('');
```

Update `handleStartOver()` to reset new state:
```typescript
setAdjustRows(null);
setApiFetching(false);
setApiFetchError('');
```

### 3. Add `handleFetchFromApi()` Function

```typescript
async function handleFetchFromApi() {
  setApiFetching(true);
  setApiFetchError('');
  try {
    const url = new URL('/api/adjust/revenue', window.location.origin);
    if (appFilter) url.searchParams.set('app', appFilter);
    const res = await fetch(url.toString());
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Failed to fetch from Adjust API');
    const rows = data.rows as AdjustRow[];
    setAdjustRows(rows);

    // Run aggregations (same as handleAnalyze does after CSV parse)
    const adjustMap = aggregateByCampaignId(rows);
    const adjustAllRevMap = aggregateAllRevByCampaignId(rows);
    const adjustAdSetMap = aggregateByAdSetId(rows);
    const adjustAllRevAdSetMap = aggregateAllRevByAdSetId(rows);
    const adjustAppMap = aggregateAppByCampaignId(rows);
    setAdjustMapState(adjustMap);
    setAdjustAllRevMapState(adjustAllRevMap);
    setAdjustAdSetMapState(adjustAdSetMap);
    setAdjustAllRevAdSetMapState(adjustAllRevAdSetMap);
    setAdjustAppMapState(adjustAppMap);

    setPhase('csv_ready'); // Enables the "Fetch & Analyze" step
  } catch (err) {
    setApiFetchError(err instanceof Error ? err.message : 'Failed to fetch from Adjust API');
  } finally {
    setApiFetching(false);
  }
}
```

### 4. Modify `handleAnalyze()` (~line 233)

Replace the CSV parsing in the Promise.all:
```typescript
// BEFORE:
const [fbRes, adjustRows] = await Promise.all([
  fetch(url.toString()).then((r) => r.json()),
  parseAdjustCsv(csvFile, appFilter),
]);

// AFTER:
const [fbRes, rows] = await Promise.all([
  fetch(url.toString()).then((r) => r.json()),
  adjustRows
    ? Promise.resolve(adjustRows)                    // Use API-fetched rows
    : csvFile
      ? parseAdjustCsv(csvFile, appFilter)           // Fallback to CSV
      : Promise.resolve([] as AdjustRow[]),           // No data
]);
```

Then replace all subsequent references from `adjustRows` to `rows` in handleAnalyze (the aggregation calls).

**Important:** The `adjustRows` variable name conflicts with the destructured const. Rename the state variable or the destructured variable. Recommended: keep state as `adjustRows`, rename destructured to `parsedRows`:
```typescript
const [fbRes, parsedRows] = await Promise.all([...]);
const adjustMap = aggregateByCampaignId(parsedRows);
// ... etc
```

**Wait** — actually, if `handleFetchFromApi()` already runs the aggregation functions and sets state, then `handleAnalyze()` only needs to:
1. Fetch FB campaigns
2. If `adjustRows` is null (CSV mode), parse CSV and run aggregations
3. If `adjustRows` is set (API mode), aggregations already in state — skip to merge

Simpler approach for `handleAnalyze()`:
```typescript
async function handleAnalyze() {
  if (!adjustRows && !csvFile) return;  // Need at least one data source
  setPhase('analyzing');
  setErrorMsg('');
  setSelectedIds(new Set());
  setAccountFilter('');

  try {
    const url = new URL('/api/campaigns', window.location.origin);
    if (viewingStaffId) url.searchParams.set('viewAs', viewingStaffId);

    // If CSV mode, parse CSV in parallel with FB fetch
    if (!adjustRows && csvFile) {
      const [fbRes, parsedRows] = await Promise.all([
        fetch(url.toString()).then((r) => r.json()),
        parseAdjustCsv(csvFile, appFilter),
      ]);
      if (fbRes.error) throw new Error(fbRes.error);

      const adjustMap = aggregateByCampaignId(parsedRows);
      const adjustAllRevMap = aggregateAllRevByCampaignId(parsedRows);
      const adjustAdSetMap = aggregateByAdSetId(parsedRows);
      const adjustAllRevAdSetMap = aggregateAllRevByAdSetId(parsedRows);
      const adjustAppMap = aggregateAppByCampaignId(parsedRows);
      setRawFbCampaigns(fbRes.campaigns as CampaignRow[]);
      setAdjustMapState(adjustMap);
      setAdjustAllRevMapState(adjustAllRevMap);
      setAdjustAdSetMapState(adjustAdSetMap);
      setAdjustAllRevAdSetMapState(adjustAllRevAdSetMap);
      setAdjustAppMapState(adjustAppMap);
      setMergedCampaigns(mergeCampaigns(fbRes.campaigns, adjustMap, adjustAllRevMap, vndRate));
    } else {
      // API mode: aggregations already in state from handleFetchFromApi
      const fbRes = await fetch(url.toString()).then((r) => r.json());
      if (fbRes.error) throw new Error(fbRes.error);
      setRawFbCampaigns(fbRes.campaigns as CampaignRow[]);
      setMergedCampaigns(mergeCampaigns(fbRes.campaigns, adjustMapState, adjustAllRevMapState, vndRate));
    }
    setPhase('results');
    fetchSnapshots();
  } catch (err) {
    setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
    setPhase('error');
  }
}
```

**Actually, the simplest approach** is: `handleFetchFromApi` sets aggregation state AND sets `phase: 'csv_ready'`. Then `handleAnalyze` checks if aggregations are already populated (via `adjustRows` state). If yes, skip CSV parse + aggregation. If no, parse CSV as before.

### 5. Update Step 1 UI (~line 454)

Replace the current Step 1 section with conditional rendering:

```tsx
{/* Step 1: Adjust Data Source */}
<div className="space-y-2">
  <div className="flex items-center gap-2">
    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-semibold">1</span>
    <h2 className="font-medium text-slate-900">
      {hasAdjustToken ? 'Get Adjust Revenue Data' : 'Upload Adjust CSV'}
    </h2>
  </div>

  {/* API fetch (primary when token configured) */}
  {hasAdjustToken && (
    <div className="space-y-2">
      <button
        onClick={handleFetchFromApi}
        disabled={!hasFbConfig || apiFetching || !!adjustRows}
        className="w-full py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
      >
        {apiFetching ? 'Fetching from Adjust API...' : adjustRows ? `Fetched ${adjustRows.length} rows` : "Fetch today's data from Adjust API"}
      </button>
      {apiFetchError && (
        <p className="text-xs text-red-600">{apiFetchError}</p>
      )}
      {adjustRows && (
        <button
          onClick={() => { setAdjustRows(null); setApiFetchError(''); }}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          Clear and re-fetch
        </button>
      )}
    </div>
  )}

  {/* CSV upload (primary when no token, secondary when token configured) */}
  {hasAdjustToken && !adjustRows && (
    <details className="text-xs text-slate-500">
      <summary className="cursor-pointer hover:text-slate-700">
        Or upload CSV manually
      </summary>
      <div className="mt-2">
        <AdjustCsvUpload onReady={handleCsvReady} disabled={!hasFbConfig} />
      </div>
    </details>
  )}
  {!hasAdjustToken && (
    <>
      <p className="text-xs text-slate-500">Export from Adjust → Analytics → Campaign report</p>
      <AdjustCsvUpload onReady={handleCsvReady} disabled={!hasFbConfig} />
    </>
  )}
</div>
```

### 6. Update `csv_ready` Phase Gate

Currently `phase === 'csv_ready'` shows the Analyze button. This should also trigger when API rows are loaded:

```typescript
{(phase === 'csv_ready' || (adjustRows && phase === 'idle')) && (
```

Actually simpler: `handleFetchFromApi` already sets `phase: 'csv_ready'`, so no change needed here.

But update the `handleAnalyze()` guard:
```typescript
// BEFORE: if (!csvFile) return;
// AFTER:
if (!adjustRows && !csvFile) return;
```

## Todo List

- [ ] Update `app/dashboard/page.tsx` to read `adjust_api_token` and pass `hasAdjustToken` prop
- [ ] Add `hasAdjustToken` to CampaignHub Props interface
- [ ] Add `adjustRows`, `apiFetching`, `apiFetchError` state
- [ ] Add `handleFetchFromApi()` function
- [ ] Modify `handleAnalyze()` to use API rows when available
- [ ] Update Step 1 UI with conditional API/CSV rendering
- [ ] Reset new state in `handleStartOver()`
- [ ] Test: no token → CSV-only flow unchanged
- [ ] Test: with token → API fetch → Analyze → ROAS table renders
- [ ] Test: API error → fallback to CSV upload
- [ ] Test: API data matches CSV data for same date
- [ ] Verify no type errors, page compiles

## Success Criteria
- [ ] "Fetch from Adjust API" button visible when token configured
- [ ] CSV upload visible (as secondary) when token configured
- [ ] CSV upload visible (as primary) when no token
- [ ] API fetch → Analyze → same ROAS table as CSV flow
- [ ] Error during API fetch shows message + CSV fallback available
- [ ] All existing functionality (filters, snapshots, adset view, etc.) works identically
- [ ] No flicker or layout regression

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| State management complexity with dual data source | Med | Med | `adjustRows` state is the single source of truth; null = CSV mode |
| `handleAnalyze()` refactor breaks CSV flow | Med | High | CSV path is `else` branch — keep current logic verbatim |
| App filter not available before API fetch | Low | Low | Show filter dropdown after fetch (populated from returned rows) |
| Race condition: user clicks API fetch then uploads CSV | Low | Low | API fetch sets `adjustRows`; CSV `handleCsvReady` sets `csvFile`. `handleAnalyze` prioritizes `adjustRows` |

## Security Considerations
- No new security surface — client never touches token
- API route already auth-guarded (Phase 2)
- `hasAdjustToken` boolean is safe to pass as prop (no sensitive data)

## Next Steps
- Manual E2E testing with real Adjust token
- Future consideration: auto-fetch on page load when token configured (YAGNI for now)
- Future consideration: date picker for historical data (YAGNI for now)
