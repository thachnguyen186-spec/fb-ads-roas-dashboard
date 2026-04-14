# Phase 2: FB Ad Sets API + Route

## Context Links
- [plan.md](plan.md)
- [phase-01](phase-01-types-and-adjust-adsets.md)
- [lib/facebook/campaigns.ts](../../lib/facebook/campaigns.ts) — pattern to follow
- [lib/facebook/campaign-actions.ts](../../lib/facebook/campaign-actions.ts) — pattern for actions
- [app/api/campaigns/[campaignId]/route.ts](../../app/api/campaigns/[campaignId]/route.ts) — pattern for route

## Overview
- **Priority:** P1 (blocks Phase 3 UI)
- **Status:** Completed
- **Effort:** 1.5h
- Create `fetchAdSets()` for FB Marketing API, ad set actions, and two new API routes

## Key Insights
- FB endpoint: `GET /{campaign_id}/adsets` with inline insights (same pattern as campaigns)
- Ad sets have their own `daily_budget`/`lifetime_budget` fields (independent of campaign budget)
- Budget update uses same `PATCH /{adset_id}` endpoint as campaigns (same field names)
- Ad set pause: `PATCH /{adset_id}` with `{ status: 'PAUSED' }` — identical to campaign

## Architecture

```
GET /api/campaigns/[campaignId]/adsets
  ├── Auth check (Supabase)
  ├── viewAs support (leader/admin)
  ├── fetchAdSets(token, campaignId, currency)
  └── Return { adsets: AdSetRow[] }

PATCH /api/adsets/[adsetId]
  ├── Auth check
  ├── Parse body: { action: 'budget' | 'pause', ... }
  ├── pauseAdSet() or updateAdSetBudget()
  └── Return { success: true }
```

## Files to Create
- `lib/facebook/adsets.ts` — `fetchAdSets()`
- `lib/facebook/adset-actions.ts` — `pauseAdSet()`, `updateAdSetBudget()`
- `app/api/campaigns/[campaignId]/adsets/route.ts` — GET handler
- `app/api/adsets/[adsetId]/route.ts` — PATCH handler

## Implementation Steps

### Step 1: Create `lib/facebook/adsets.ts`

Mirror `campaigns.ts` structure. Key differences:
- Endpoint: `GET /{campaignId}/adsets` (not `/{accountId}/campaigns`)
- Fields include `campaign_id` so we know the parent
- No filtering by effective_status (show all active ad sets under the campaign)

```typescript
import { fbGet } from './fb-client';
import type { AdSetRow } from '@/lib/types';

const ADSET_FIELDS = [
  'id', 'name', 'campaign_id', 'status', 'effective_status',
  'daily_budget', 'lifetime_budget', 'budget_remaining',
].join(',');

const INSIGHT_FIELDS = 'spend,impressions,clicks,cpm,cpc';

// RawAdSet, RawPageResponse interfaces (same shape as campaigns)

export async function fetchAdSets(
  token: string,
  campaignId: string,
  accountId: string,
  currency: string = 'USD',
): Promise<AdSetRow[]> {
  const adsets: AdSetRow[] = [];
  const insightFields = `insights.date_preset(today){${INSIGHT_FIELDS}}`;
  let after: string | undefined;

  do {
    const params: Record<string, string> = {
      fields: `${ADSET_FIELDS},${insightFields}`,
      filtering: JSON.stringify([
        { field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }
      ]),
      limit: '100',
    };
    if (after) params.after = after;

    const page = await fbGet(`/${campaignId}/adsets`, params, token);
    // Map each raw ad set to AdSetRow (reuse centsToUsd, toFloat, toInt helpers)
    // Set campaign_id, account_id, currency from params

    after = page.paging?.cursors?.after;
    if (!page.paging?.next) break;
  } while (after);

  return adsets;
}
```

**Important:** Extract `centsToUsd`, `toFloat`, `toInt`, `resolveBudgetType` into shared helpers or duplicate them (they're 4 one-liners; DRY vs coupling tradeoff — prefer duplication here since files are small).

### Step 2: Create `lib/facebook/adset-actions.ts`

```typescript
import { fbPatch } from './fb-client';

export async function pauseAdSet(token: string, adsetId: string): Promise<void> {
  await fbPatch(`/${adsetId}`, { status: 'PAUSED' }, token);
}

export async function updateAdSetBudget(
  token: string,
  adsetId: string,
  budgetType: 'daily' | 'lifetime',
  amountUsd: number,
): Promise<void> {
  const cents = Math.round(amountUsd * 100);
  const field = budgetType === 'daily' ? 'daily_budget' : 'lifetime_budget';
  await fbPatch(`/${adsetId}`, { [field]: String(cents) }, token);
}
```

### Step 3: Create `app/api/campaigns/[campaignId]/adsets/route.ts`

GET handler — follows same auth pattern as existing campaign route:

```typescript
import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { canViewAs } from '@/lib/auth-guards';
import { fetchAdSets } from '@/lib/facebook/adsets';

type Params = { params: Promise<{ campaignId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { campaignId } = await params;

  // 1. Auth check
  // 2. Get token (own or viewAs target's token)
  // 3. Read accountId + currency from query params
  //    (client passes ?accountId=act_XXX&currency=VND)
  // 4. fetchAdSets(token, campaignId, accountId, currency)
  // 5. Return { adsets: AdSetRow[] }
}
```

**Query params needed from client:** `accountId`, `currency` — the campaign row already has these, client passes them when expanding.

### Step 4: Create `app/api/adsets/[adsetId]/route.ts`

PATCH handler — near-identical to campaign PATCH route:

```typescript
type Params = { params: Promise<{ adsetId: string }> };

type ActionBody =
  | { action: 'pause' }
  | { action: 'budget'; budget_type: 'daily' | 'lifetime'; amount_usd: number };

export async function PATCH(request: NextRequest, { params }: Params) {
  // 1. Auth (same as campaign route)
  // 2. Parse body
  // 3. Switch on action: pauseAdSet() or updateAdSetBudget()
  // 4. Return { success: true }
}
```

Validation: `amount_usd > 0 && amount_usd <= 1_000_000` (same as campaigns).

## Todo List
- [x] Create `lib/facebook/adsets.ts` with `fetchAdSets()`
- [x] Create `lib/facebook/adset-actions.ts` with `pauseAdSet()` + `updateAdSetBudget()`
- [x] Create `app/api/campaigns/[campaignId]/adsets/route.ts` (GET)
- [x] Create `app/api/adsets/[adsetId]/route.ts` (PATCH)
- [x] Verify `npm run build` passes

## Success Criteria
- `GET /api/campaigns/{id}/adsets` returns `AdSetRow[]` with budget + insights
- `PATCH /api/adsets/{id}` with budget action updates FB successfully
- Auth + viewAs work identically to campaign routes
- Error responses follow existing `errorResponse()` pattern

## Risk
- **FB rate limits:** Each campaign expand = 1 API call. If user expands 20 campaigns rapidly, could hit limits. Mitigation: client debounces/caches; no server-side caching needed for MVP.
- **Ad sets with ABO vs CBO:** Campaign Budget Optimization (CBO) campaigns set budget at campaign level; ad sets under CBO may not have individual budgets. The `budget_type: 'unknown'` fallback handles this — UI will hide budget edit button.

## Security
- Same auth guard pattern as campaigns (Supabase session + profile token lookup)
- viewAs protected by `canViewAs()` — leader can only view own staff
- Token never exposed to client
