# Phase 4: Budget Column + Ad Set Budget Edit

## Context Links
- [plan.md](plan.md)
- [phase-03](phase-03-collapsible-table-ui.md)
- [budget-modal.tsx](../../app/dashboard/components/budget-modal.tsx)
- [action-bar.tsx](../../app/dashboard/components/action-bar.tsx)

## Overview
- **Priority:** P1
- **Status:** Completed
- **Effort:** 1.5h
- Show budget column for campaigns and ad sets; add per-row "Edit budget" button; reuse BudgetModal for ad sets

## Key Insights
- BudgetModal currently accepts `MergedCampaign` — needs generalization to accept ad sets too
- Both `MergedCampaign` and `MergedAdSet` share budget fields (`daily_budget`, `lifetime_budget`, `budget_type`) and a name field
- Best approach: define a `BudgetTarget` interface with the shared shape, pass that to BudgetModal
- Campaign budget edit already works via action-bar; ad set budget edit will be inline per-row (no selection needed)
- After budget update, invalidate ad set cache for that campaign so next expand re-fetches

## Data Flow

```
User clicks "Edit" on ad set row budget cell
  └──► campaign-table.tsx sets budgetTarget: { type: 'adset', id, name, budget fields }
  └──► BudgetModal opens with current budget
  └──► User confirms new amount
  └──► PATCH /api/adsets/{adsetId} { action: 'budget', budget_type, amount_usd }
  └──► On success: invalidate adSetCache for parent campaign, re-fetch
```

## Files to Modify
- `lib/types.ts` — add `BudgetTarget` union type
- `app/dashboard/components/budget-modal.tsx` — accept `BudgetTarget` instead of `MergedCampaign`
- `app/dashboard/components/campaign-table.tsx` — add budget column, per-row edit button, modal integration
- `app/dashboard/components/action-bar.tsx` — update BudgetModal usage to match new props

## Implementation Steps

### Step 1: Add `BudgetTarget` type to `lib/types.ts`

```typescript
/** Shared shape for budget modal — works for both campaigns and ad sets */
export interface BudgetTarget {
  type: 'campaign' | 'adset';
  id: string;
  name: string;
  daily_budget: number | null;
  lifetime_budget: number | null;
  budget_type: 'daily' | 'lifetime' | 'unknown';
}
```

### Step 2: Update `budget-modal.tsx`

Change Props from `campaign: MergedCampaign` to `target: BudgetTarget`:

```typescript
interface Props {
  target: BudgetTarget;
  onConfirm: (amountUsd: number) => void;
  onClose: () => void;
}
```

Internal changes:
- Replace `campaign.budget_type` → `target.budget_type`
- Replace `campaign.daily_budget` → `target.daily_budget`
- Replace `campaign.lifetime_budget` → `target.lifetime_budget`
- Replace `campaign.campaign_name` → `target.name`

This is a straightforward rename — no logic change.

### Step 3: Update `action-bar.tsx` to match new BudgetModal props

Where `setBudgetTarget(singleCampaign)` is called, convert to `BudgetTarget`:

```typescript
function campaignToBudgetTarget(c: MergedCampaign): BudgetTarget {
  return {
    type: 'campaign',
    id: c.campaign_id,
    name: c.campaign_name,
    daily_budget: c.daily_budget,
    lifetime_budget: c.lifetime_budget,
    budget_type: c.budget_type,
  };
}
```

Update state type: `const [budgetTarget, setBudgetTarget] = useState<BudgetTarget | null>(null)`

Update `BudgetModal` usage:
```tsx
<BudgetModal target={budgetTarget} onConfirm={handleBudgetConfirm} onClose={...} />
```

Update `handleBudgetConfirm` — API URL depends on `budgetTarget.type`:
```typescript
const url = budgetTarget.type === 'campaign'
  ? `/api/campaigns/${budgetTarget.id}`
  : `/api/adsets/${budgetTarget.id}`;
```

### Step 4: Add budget column to `campaign-table.tsx`

Add "Budget" column header in the FB section (after Status, before Spend):

```tsx
<th className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50/40">Budget</th>
```

Update `fbColSpan` calculation: increment by 1.

Campaign row budget cell:

```tsx
<td className="px-3 py-2.5 text-right tabular-nums text-gray-600 bg-blue-50/20">
  <div className="flex items-center justify-end gap-1">
    <span>{fmtUsd(c.daily_budget ?? c.lifetime_budget)}</span>
    {c.budget_type !== 'unknown' && (
      <button
        onClick={(e) => { e.stopPropagation(); openBudgetModal(c); }}
        className="text-blue-500 hover:text-blue-700 text-[10px]"
        title="Edit budget"
      >
        Edit
      </button>
    )}
  </div>
  <div className="text-[10px] text-gray-400">
    {c.budget_type === 'daily' ? '/day' : c.budget_type === 'lifetime' ? 'lifetime' : ''}
  </div>
</td>
```

Ad set sub-row budget cell — same layout, different click handler:

```tsx
<td className="px-3 py-2 text-right tabular-nums text-gray-500 bg-blue-50/10">
  <div className="flex items-center justify-end gap-1">
    <span className="text-xs">{fmtUsd(adset.daily_budget ?? adset.lifetime_budget)}</span>
    {adset.budget_type !== 'unknown' && (
      <button
        onClick={() => openAdSetBudgetModal(adset)}
        className="text-blue-500 hover:text-blue-700 text-[10px]"
      >
        Edit
      </button>
    )}
  </div>
</td>
```

### Step 5: Budget modal integration in `campaign-table.tsx`

Add state and handlers:

```typescript
const [budgetTarget, setBudgetTarget] = useState<BudgetTarget | null>(null);

function openBudgetModal(c: MergedCampaign) {
  setBudgetTarget({
    type: 'campaign', id: c.campaign_id, name: c.campaign_name,
    daily_budget: c.daily_budget, lifetime_budget: c.lifetime_budget,
    budget_type: c.budget_type,
  });
}

function openAdSetBudgetModal(a: MergedAdSet) {
  setBudgetTarget({
    type: 'adset', id: a.adset_id, name: a.adset_name,
    daily_budget: a.daily_budget, lifetime_budget: a.lifetime_budget,
    budget_type: a.budget_type,
  });
}
```

Add callback prop for budget confirm (or handle inline):

```typescript
// New prop from campaign-hub:
onBudgetUpdate?: (target: BudgetTarget, amountUsd: number) => Promise<void>;
```

Or keep fetch logic inside table (simpler for ad sets). On confirm:

```typescript
async function handleBudgetConfirm(amountUsd: number) {
  if (!budgetTarget) return;
  const url = budgetTarget.type === 'campaign'
    ? `/api/campaigns/${budgetTarget.id}`
    : `/api/adsets/${budgetTarget.id}`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'budget',
      budget_type: budgetTarget.budget_type,
      amount_usd: amountUsd,
    }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error ?? 'Budget update failed');
  }

  // Invalidate ad set cache if ad set budget changed
  if (budgetTarget.type === 'adset') {
    // Find parent campaign_id from adSetCache and delete entry
    // This forces re-fetch on next expand
  }

  setBudgetTarget(null);
}
```

Render modal at bottom of table component:

```tsx
{budgetTarget && (
  <BudgetModal
    target={budgetTarget}
    onConfirm={handleBudgetConfirm}
    onClose={() => setBudgetTarget(null)}
  />
)}
```

### Step 6: Cache Invalidation

After successful ad set budget update, remove the parent campaign from `adSetCache`:

```typescript
// In campaign-table, the adset has campaign_id
// After PATCH success for an adset:
setAdSetCache((prev) => {
  const next = new Map(prev);
  // Find which campaign contains this adset
  for (const [campId, adsets] of next) {
    if (adsets.some((a) => a.adset_id === budgetTarget.id)) {
      next.delete(campId);
      break;
    }
  }
  return next;
});
```

This forces re-fetch when user re-expands, showing updated budget.

## Todo List
- [x] Add `BudgetTarget` type to `lib/types.ts`
- [x] Refactor `budget-modal.tsx` Props: `campaign` → `target: BudgetTarget`
- [x] Update `action-bar.tsx` to use `BudgetTarget` for campaign budget
- [x] Add Budget column header + cells to campaign rows in `campaign-table.tsx`
- [x] Add Budget cells to ad set sub-rows
- [x] Add inline "Edit" button per row (campaign + ad set)
- [x] Wire BudgetModal in `campaign-table.tsx` for ad set budget edits
- [x] Invalidate ad set cache after budget update
- [x] Verify `npm run build` passes
- [x] Manual test: edit campaign budget, edit ad set budget, verify values update

## Success Criteria
- Budget column visible for all campaign rows (daily/day or lifetime label)
- Budget column visible in ad set sub-rows
- Clicking "Edit" opens BudgetModal with correct current value
- Campaign budget update hits `/api/campaigns/{id}` (existing)
- Ad set budget update hits `/api/adsets/{id}` (new from Phase 2)
- After ad set budget update, re-expanding shows fresh data
- BudgetModal reused — no duplication

## Risk
- **CBO campaigns:** Ad sets under CBO campaigns have no individual budget. `budget_type: 'unknown'` hides edit button — safe.
- **Action bar vs inline budget edit conflict:** Campaign budget can be edited from both action bar (selection) and inline button. Both use same API. No conflict — action bar is for bulk selection, inline is single-click convenience.

## Security
- Same PATCH auth as campaigns — token from server-side profile, never exposed
- Budget validation: `> 0 && <= 1,000,000 USD` enforced server-side
