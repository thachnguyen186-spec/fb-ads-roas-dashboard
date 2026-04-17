# Phase 2: Adjust API Client & Route

## Context Links
- [CSV parser (reference only — DO NOT MODIFY)](../../lib/adjust/csv-parser.ts)
- [Types (reference only — DO NOT MODIFY)](../../lib/types.ts)
- [Plan overview](./plan.md)
- [Phase 1 (dependency)](./phase-01-token-storage-settings.md)

## Overview
- **Priority:** P1 (blocks Phase 3)
- **Status:** Pending
- **Description:** Create server-side Adjust API client that fetches today's revenue data and returns `AdjustRow[]`. Expose via authenticated API route.

## Key Insights
- Adjust Report API returns plain CSV — same format as manual export
- Response columns use `campaign_id_network`, `campaign_network`, `adgroup_id_network`, `adgroup_network` — must map to `AdjustRow` fields
- `partner_name` column filters to Facebook traffic — value could be "facebook" or "Facebook Ads" (case-insensitive match needed)
- `cohort_all_revenue` may be absent for some app configs — fallback to 0
- PapaParse already in project deps (used by csv-parser.ts) — reuse for server-side CSV parsing

## Requirements

### Functional
- `fetchAdjustRevenueToday(token, appFilter?)` → `Promise<AdjustRow[]>`
- Calls Adjust CSV Report API with today's date, correct dimensions/metrics
- Filters to Facebook rows only, validates campaign IDs are numeric
- Maps columns to match `AdjustRow` interface exactly
- API route: `GET /api/adjust/revenue?app={appName}` (optional app filter)
- Returns `{ rows: AdjustRow[] }` on success, `{ error: string }` on failure

### Non-Functional
- Token read from DB server-side only (never from request body/headers from client)
- Timeout: 30s for Adjust API call (their CSV reports can be slow)
- Error messages must not leak token value

## Architecture

```
GET /api/adjust/revenue
  ├─ Auth check (Supabase)
  ├─ Read adjust_api_token from profiles (service client)
  ├─ Call: https://automate.adjust.com/reports-service/csv_report
  │    Headers: Authorization: Bearer {token}
  │    Params: date_period, dimensions, metrics, ad_spend_mode, filter_by
  ├─ Parse CSV response (PapaParse)
  ├─ Map columns → AdjustRow fields
  ├─ Filter: partner_name contains "facebook" (case-insensitive)
  ├─ Validate: campaign_id is numeric
  └─ Return { rows: AdjustRow[] }
```

### Column Mapping (Adjust API → AdjustRow)

| Adjust API column | AdjustRow field | Notes |
|-------------------|----------------|-------|
| `campaign_id_network` | `campaign_id` | Must be purely numeric |
| `campaign_network` | `campaign_name` | |
| `adgroup_id_network` | `adset_id` | Optional, may be empty |
| `adgroup_network` | `adset_name` | Optional |
| `app` | `app` | |
| `cohort_all_revenue` | `revenue` | Fallback to 0 if column absent |
| `all_revenue` | `all_revenue` | |
| `partner_name` | (filter only) | Must contain "facebook" |
| `network_cost` | (not mapped) | Available for future verification |

## Related Code Files

### Files to Create
| File | Purpose |
|------|---------|
| `lib/adjust/api-client.ts` | `fetchAdjustRevenueToday()` function |
| `app/api/adjust/revenue/route.ts` | Authenticated GET endpoint |

### Files NOT Modified
- `lib/adjust/csv-parser.ts` — untouched
- `lib/adjust/merge.ts` — untouched
- `lib/types.ts` — untouched (AdjustRow interface already sufficient)

## Implementation Steps

### 1. Create `lib/adjust/api-client.ts`

```typescript
import Papa from 'papaparse';
import type { AdjustRow } from '@/lib/types';

const ADJUST_API_URL = 'https://automate.adjust.com/reports-service/csv_report';
const INVALID_IDS = new Set(['unknown', 'expired attributions', '']);

function isValidCampaignId(id: string): boolean {
  if (!id) return false;
  if (INVALID_IDS.has(id.trim().toLowerCase())) return false;
  return /^\d+$/.test(id.trim());
}

function toNum(val: unknown): number {
  if (val === undefined || val === null || val === '') return 0;
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  return isNaN(n) ? 0 : n;
}

interface AdjustApiRow {
  app: string;
  partner_name: string;
  campaign_id_network: string;
  campaign_network: string;
  adgroup_id_network?: string;
  adgroup_network?: string;
  network_cost?: number | string;
  all_revenue: number | string;
  cohort_all_revenue?: number | string;
}

export async function fetchAdjustRevenueToday(
  token: string,
  appFilter?: string,
): Promise<AdjustRow[]> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const params = new URLSearchParams({
    date_period: `${today}:${today}`,
    dimensions: 'app,partner_name,campaign_id_network,campaign_network,adgroup_id_network,adgroup_network',
    metrics: 'network_cost,all_revenue,cohort_all_revenue',
    ad_spend_mode: 'network',
    filter_by: 'partner_name:facebook',
  });

  const res = await fetch(`${ADJUST_API_URL}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Adjust API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const csvText = await res.text();

  return new Promise((resolve, reject) => {
    Papa.parse<AdjustApiRow>(csvText, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete(results) {
        const rows: AdjustRow[] = [];
        for (const row of results.data) {
          // Double-check Facebook filter (API filter_by may not be exact)
          if (!row.partner_name?.toLowerCase().includes('facebook')) continue;
          if (!isValidCampaignId(String(row.campaign_id_network ?? ''))) continue;
          if (appFilter && row.app !== appFilter) continue;

          const adsetId = String(row.adgroup_id_network ?? '').trim();
          rows.push({
            campaign_id: String(row.campaign_id_network).trim(),
            campaign_name: row.campaign_network ?? '',
            app: row.app ?? '',
            revenue: toNum(row.cohort_all_revenue),
            all_revenue: toNum(row.all_revenue),
            adset_id: adsetId || undefined,
            adset_name: row.adgroup_network ? String(row.adgroup_network) : undefined,
          });
        }
        resolve(rows);
      },
      error(err) {
        reject(new Error(`Adjust CSV parse error: ${err.message}`));
      },
    });
  });
}
```

Key decisions:
- Reuses same `INVALID_IDS`, `isValidCampaignId`, `toNum` logic from csv-parser.ts (not importing to avoid coupling — DRY exception justified since csv-parser runs client-side and this runs server-side)
- `filter_by: 'partner_name:facebook'` in API params + client-side re-check for safety
- `AbortSignal.timeout(30_000)` for network timeout
- Error messages truncated to avoid leaking sensitive response data

### 2. Create `app/api/adjust/revenue/route.ts`

```typescript
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { fetchAdjustRevenueToday } from '@/lib/adjust/api-client';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const service = createServiceClient();
  const { data: profile } = await service
    .from('profiles')
    .select('adjust_api_token')
    .eq('id', user.id)
    .single();

  const token = (profile as { adjust_api_token?: string | null } | null)?.adjust_api_token;
  if (!token) return errorResponse('Adjust API token not configured', 400);

  const url = new URL(request.url);
  const appFilter = url.searchParams.get('app') || undefined;

  try {
    const rows = await fetchAdjustRevenueToday(token, appFilter);
    return Response.json({ rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch from Adjust';
    return errorResponse(msg, 502);
  }
}
```

### 3. Create API route directory

```
app/api/adjust/revenue/route.ts
```

## Todo List

- [ ] Create `lib/adjust/api-client.ts` with `fetchAdjustRevenueToday()`
- [ ] Create `app/api/adjust/revenue/route.ts`
- [ ] Verify PapaParse works server-side (Node.js compatible — it does)
- [ ] Test with real Adjust token: verify column names match expected
- [ ] Test error case: invalid/expired token returns 502 with safe message
- [ ] Test empty response: no Facebook rows → returns empty array
- [ ] Test app filter parameter works correctly
- [ ] Compare output with CSV upload for same date — must be identical `AdjustRow[]`

## Success Criteria
- [ ] `GET /api/adjust/revenue` returns `{ rows: AdjustRow[] }` when token configured
- [ ] Returns 400 when no token configured
- [ ] Returns 502 with error message on Adjust API failure
- [ ] Output `AdjustRow[]` matches what `parseAdjustCsv()` produces for same data
- [ ] Token value never appears in error messages or response body
- [ ] Compiles without type errors

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Adjust API column names differ from CSV export | Med | High | Explicit mapping + fallback to 0 for optional fields; test with real token in Phase 2 |
| `partner_name` value not exactly "facebook" | Med | Med | Case-insensitive `.includes('facebook')` catches "Facebook Ads", "facebook", etc. |
| Adjust API rate limiting | Low | Med | Single call per user action; no polling or retry loops |
| PapaParse server-side incompatibility | Low | Low | PapaParse supports Node.js; parse from string (not File) |
| Large CSV response (many apps/campaigns) | Low | Med | `filter_by` limits to Facebook; 30s timeout |

## Security Considerations
- Token fetched from DB server-side only — never from client request
- Error messages from Adjust truncated to 200 chars to avoid leaking sensitive data
- Auth guard prevents unauthenticated access
- No token caching in memory (fetched fresh each request)

## Next Steps
- Phase 3 consumes this route from the dashboard UI
- Future: add date range parameter for historical lookups (YAGNI for now)
