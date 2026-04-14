# Phase 05 — Campaign Actions (Pause / Budget / Duplicate)

## Context Links
- Parent plan: [plan.md](./plan.md)
- FB API research: [researcher-fb-api-report.md](./research/researcher-fb-api-report.md)
- Phase 02 (FB client): [phase-02-fb-api-campaigns.md](./phase-02-fb-api-campaigns.md)
- Phase 04 (UI + selection): [phase-04-campaign-dashboard-ui.md](./phase-04-campaign-dashboard-ui.md)

## Overview
- **Date:** 2026-04-14
- **Priority:** P1
- **Status:** pending (requires Phase 04)
- **Description:** Implement two manual campaign actions — pause and budget update — triggered from the `ActionBar` when campaigns are selected. Duplicate deferred to future phase.

## Key Insights
- All actions call FB Marketing API via server-side API routes (token never exposed to client)
- **Pause:** PATCH `/act_{id}/campaigns` with `{ status: 'PAUSED' }` or per-campaign PATCH `/{campaign_id}` with `status`
- **Budget update:** PATCH `/{campaign_id}` with `daily_budget` or `lifetime_budget` (value in **cents**)
  - Cannot switch between daily ↔ lifetime budget types — update only the existing type
  - Lifetime budget campaigns: cannot reduce below already spent amount
- **Duplicate:** POST `/act_{ad_account_id}/campaigns` with `{ copy_from: campaign_id, status_option: 'PAUSED' }` — starts duplicated campaign as PAUSED
- Actions operate on **one campaign at a time** in the API; for bulk pause, iterate sequentially
- After action: re-fetch campaign list to reflect new state (or optimistic update)
- Confirmation dialog before destructive/irreversible actions (budget change, duplicate)

## Requirements
- `lib/facebook/campaign-actions.ts` — `pauseCampaign`, `updateBudget`
- API route: `PATCH /api/workspaces/[id]/campaigns/[campaignId]` — pause or budget update
- `ActionBar` component — appears when ≥1 row selected, shows action buttons
- `BudgetModal` — modal with absolute value input + quick percentage buttons (−20%, +20%, +50%)
- Loading + error feedback per action
- **Duplicate:** deferred to future phase

## Architecture

```
ActionBar (client, fixed bottom bar, shown when selectedIds.size > 0)
  ├── "Pause selected" button
  │     → confirm dialog → PATCH /api/.../campaigns/[id] per selected (sequential)
  └── "Set budget" button
        → BudgetModal:
            - Shows current budget type (daily/lifetime) + current value
            - Input: absolute USD value
            - Quick buttons: −50%, −20%, +20%, +50% (calculates new absolute from current)
            - Confirm → PATCH /api/.../campaigns/[id] (applies to each selected)

API Route (server-side, token from workspace):
  PATCH /api/workspaces/[id]/campaigns/[campaignId]
    body: { action: 'pause' } | { action: 'budget', budget_type: 'daily'|'lifetime', amount_usd: number }

lib/facebook/campaign-actions.ts
  pauseCampaign(token, campaignId): Promise<void>
  updateBudget(token, campaignId, type, amountUsd): Promise<void>  // converts USD → cents internally
```

## BudgetModal UX
- Shows current budget type (daily/lifetime) and current value
- Single input: "New budget (USD)"
- Warning if lifetime budget and trying to set below current spend
- Confirm button → calls API → closes modal → refreshes table

## ActionBar UX
- Floats at bottom of page when selection active (sticky bottom bar)
- Shows: "N campaigns selected" + action buttons
- Pause: available for any selection count
- Set Budget: if multiple selected, applies same budget to all (with warning)
- Duplicate: shows warning if >1 selected ("Duplicate will create N campaigns")

## Related Code Files

**Create:**
- `C:\Work\Tools\fb-ads-tool\lib\facebook\campaign-actions.ts`
- `C:\Work\Tools\fb-ads-tool\app\api\workspaces\[id]\campaigns\[campaignId]\route.ts`
- `C:\Work\Tools\fb-ads-tool\app\workspaces\[id]\campaigns\components\action-bar.tsx`
- `C:\Work\Tools\fb-ads-tool\app\workspaces\[id]\campaigns\components\budget-modal.tsx`

**Deferred (future):**
- Duplicate campaign action + API route

## Implementation Steps
1. Create `lib/facebook/campaign-actions.ts`:
   - `pauseCampaign(token, campaignId)` → `fbPatch('/{id}', { status: 'PAUSED' }, token)`
   - `updateBudget(token, campaignId, type, amountUsd)` → convert to cents (×100) → `fbPatch('/{id}', { [type]: cents }, token)`

2. Create `app/api/workspaces/[id]/campaigns/[campaignId]/route.ts`:
   - `PATCH`: auth → workspace ownership → read `{ action, budget_type?, amount_usd? }` from body
   - Call `pauseCampaign` or `updateBudget` → return `{ success: true }`
   - Validate: `amount_usd` must be > 0 and < 1,000,000

3. Create `action-bar.tsx`:
   - `fixed bottom-0 left-0 right-0` with backdrop blur
   - Props: `selectedIds: string[]`, `campaigns: MergedCampaign[]`, `workspaceId`, `onActionComplete: () => void`
   - "Pause selected": sequential PATCH calls with progress (`Pausing 2/5...`)
   - "Set budget": open `BudgetModal`
   - On complete: call `onActionComplete` (hub optimistically updates row status in state)

4. Create `budget-modal.tsx`:
   - Props: `campaigns: MergedCampaign[]` (selected), `workspaceId`, `onClose`, `onSaved`
   - Show current budget type + value for first selected (if all same type, else show "Mixed")
   - Input: absolute USD amount
   - Quick buttons: −50%, −20%, +20%, +50% — compute new value from current budget
   - Submit → sequential PATCH for each selected campaign → `onSaved()`

## Todo List
- [ ] Create `lib/facebook/campaign-actions.ts`
- [ ] Create campaign PATCH API route
- [ ] Create duplicate POST API route
- [ ] Create `action-bar.tsx` with bulk pause + budget + duplicate
- [ ] Create `budget-modal.tsx`
- [ ] Wire ActionBar into `campaign-hub.tsx`
- [ ] Test: pause a campaign, verify status change in FB; set budget; duplicate

## Success Criteria
- Selecting campaigns shows ActionBar
- Pause action changes campaign status to PAUSED (verified in FB Ads Manager)
- Budget modal pre-fills current budget; saving updates FB campaign
- Duplicate creates new paused campaign visible in FB Ads Manager
- Table auto-refreshes after each action
- Error states displayed inline (e.g. "Failed to pause campaign: token expired")

## Risk Assessment
- **Lifetime budget:** Cannot reduce below spent — show clear error from FB API
- **Bulk actions:** Sequential FB API calls may hit rate limit for large selections (>50) — add 200ms delay between calls and show progress
- **Duplicate scope:** FB `copy_from` copies the campaign shell; ad sets and ads are NOT duplicated by default — document this in UI tooltip
- **Token expiry:** If 60-day token expires, all actions fail — show specific "Token expired" message with link to Settings

## Security Considerations
- All FB API mutations go through server-side routes — token never sent to browser
- Campaign ID from client validated against workspace ownership before action
- Budget input: parse as float, reject NaN, reject negative, reject > 1,000,000 (sanity check)

## Next Steps
→ Plan complete. Implementation ready to begin from Phase 01.
