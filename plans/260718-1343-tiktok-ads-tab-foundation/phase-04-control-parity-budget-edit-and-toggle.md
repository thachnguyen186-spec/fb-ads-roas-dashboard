# Phase 4 — Control Parity: Budget Edit + On/Off Toggle

## Context Links

- Plan overview: [plan.md](./plan.md)
- Depends on: [Phase 3](./phase-03-tiktok-dashboard-tab-read-only-view.md) (hub + table + selection)
- Uses: [Phase 1](./phase-01-tiktok-api-client-and-database-schema.md) `lib/tiktok/campaign-actions.ts`
- Mirror sources: `app/api/campaigns/[campaignId]/route.ts`, `app/api/adsets/[adsetId]/route.ts`, `app/dashboard/components/action-bar.tsx`, `app/dashboard/components/adset-flat-view.tsx`, `app/dashboard/components/budget-modal.tsx`
- Research: [TikTok Control](../reports/researcher-260718-0920-tiktok-api-auth-control.md) (§2, §4.3–4.4)

## Overview

- **Priority:** P1
- **Status:** Pending
- **Estimate:** ~4h
- **Scope:** Give TikTok campaigns + ad groups the same control parity FB has — pause/enable toggle and budget edit — via an action bar and an ad-group flat view, reusing the generic `budget-modal.tsx` as-is.

## Key Insights

- **Reuse `budget-modal.tsx` as-is** — generic via `BudgetTarget` (`lib/types.ts`): `{id, name, budget_type: 'daily'|'lifetime'|'cbo'|'unknown', daily_budget, lifetime_budget, entity_type: 'campaign'|'adset', currency, vndRate}`. TikTok maps `budget_mode 'DAILY'→'daily'`, `'LIFETIME'→'lifetime'`; `entity_type='adset'` for ad groups (UI already badges "Ad Set"). Pass `vndRate=1` (TikTok budgets are native decimals, no conversion) so the modal's VND branch is inert for USD accounts.
- TikTok "Ad Group" == FB "Ad Set". User's "same function as Facebook" includes ad-set-level parity → mirror `adset-flat-view.tsx` at ad-group level (`tiktok-adgroup-flat-view.tsx`).
- Status values are `ENABLE`/`DISABLE` (not FB's `ACTIVE`/`PAUSED`). Action bar maps: pause → `DISABLE`, enable → `ENABLE`.
- Budget update = `/campaign/update/` (single) with `{budget}`; status = `/campaign/status/update/` (batch ≤100). Same at ad-group level. All in Phase 1 `campaign-actions.ts`.
- **Budget minimums** (research §4.4): campaign $50/day, ad group $20/day — 🔴 **this is a DAILY-mode-only figure.** Research §4.4 also states lifetime minimum is dynamic: "daily min × number of days." Surface as inline validation/help text in the budget modal reuse — warn, don't silently reject server-side only. `budget_mode` immutable after creation — irrelevant for read/control, but the modal must not offer switching daily↔lifetime.
- > 🔴 **Red Team Fix (2026-07-18):** control routes in this phase were originally specified as "authenticated user only" — inconsistent with Phase 2's `admin`/`leader` gating and a real privilege-escalation gap: TikTok is one shared org-wide credential, so an ungated PATCH route lets ANY staff account pause or re-budget every campaign in every connected advertiser account (unlike FB, where each user's blast radius is limited to their own pasted token). **Both PATCH routes below now require `requireRole(['admin','leader'])`** — day-to-day control (unlike OAuth reconnection, which is `admin`-only per Phase 2) is reasonable for leaders who manage campaigns operationally, mirroring how leaders already view/manage their team's FB campaigns.
- > 🔴 **Red Team Fix (2026-07-18):** no check that the client-supplied `campaign_id`/`adgroup_id` actually belongs to the supplied `advertiser_id` — only that the `advertiser_id` itself is a selected org account. Add a lightweight app-side ownership check (or confirm empirically that TikTok's own API rejects mismatched pairs and rely on that, documenting the verification).

## Requirements

### Functional
- `PATCH /api/tiktok/campaigns/[campaignId]` — 🔴 `requireRole(['admin','leader'])`; actions `pause` | `enable` | `budget` (mirrors FB campaign route, plus the role gate FB doesn't need). Needs `advertiser_id` (from body — campaign→advertiser mapping known client-side from the row); 🔴 server verifies the campaign belongs to that advertiser before mutating.
- `PATCH /api/tiktok/adgroups/[adgroupId]` — 🔴 same role gate + ownership check, same actions at ad-group level.
- `tiktok-action-bar.tsx` — mirrors `action-bar.tsx`; operates on selected `MergedTiktokCampaign[]`; calls `/api/tiktok/...`; reuses `budget-modal.tsx`. No Duplicate button (Plan 2). 🔴 Bulk pause/enable reconciles post-action state against the selection and reports partial failures explicitly (not a generic success toast).
- `tiktok-adgroup-flat-view.tsx` — mirrors `adset-flat-view.tsx`; lists ad groups with budget edit + selection; per-row/bulk on-off.
- Wire action bar + ad-group view into `tiktok-campaign-hub.tsx`.

### Non-functional
- Files < 200 lines each.
- Optimistic UI + re-fetch on success (mirror FB action bar `onActionComplete`).
- Batch bulk status via the 100-ID chunking already in `campaign-actions.ts`.
- 🔴 Bulk status-change actions must guarantee-or-report: either all selected IDs succeed, or the user is told exactly which ones didn't (no silent partial pause).

## Architecture

### Control data flow
```
[user] select rows → action bar
  Pause  → PATCH /api/tiktok/campaigns/{id} {action:'pause', advertiser_id}
             → updateCampaignStatus(token, advId, [ids], 'DISABLE')   (chunked ≤100)
  Enable → {action:'enable'} → status 'ENABLE'
  Budget → open budget-modal (BudgetTarget) → onConfirm(amount,currency)
             → {action:'budget', budget_mode, amount, advertiser_id}
             → updateCampaignBudget(token, advId, id, amount)
  onSuccess → onActionComplete() → re-run hub Fetch Data
```
Ad-group flat view mirrors this against `/api/tiktok/adgroups/{id}`.

### Advertiser scoping
- TikTok control endpoints require `advertiser_id`. The client already has it on each `MergedTiktokCampaign`/`MergedTiktokAdGroup` row → send in the PATCH body. Server validates the advertiser is in `tiktok_advertiser_accounts` (is_selected) before acting (prevents acting on unauthorized advertisers). 🔴 **Red Team Fix:** server additionally verifies the `campaign_id`/`adgroup_id` belongs to that `advertiser_id` (via a lookup against `fetchCampaigns`/`fetchAdGroups`, or confirmed reliance on TikTok's own API rejecting mismatches — verify which during implementation) — advertiser-level validation alone doesn't prove the specific campaign/ad-group is actually owned by it.

## Related Code Files

### Create
- `app/api/tiktok/campaigns/[campaignId]/route.ts` — PATCH pause/enable/budget.
- `app/api/tiktok/adgroups/[adgroupId]/route.ts` — PATCH pause/enable/budget.
- `app/dashboard/tiktok/components/tiktok-action-bar.tsx` — selection action bar.
- `app/dashboard/tiktok/components/tiktok-adgroup-flat-view.tsx` — ad-group flat view.

### Modify
- `app/dashboard/tiktok/components/tiktok-campaign-hub.tsx` — render `<TiktokActionBar>` when rows selected; add "Ad groups only" toggle → `<TiktokAdgroupFlatView>` (mirror FB hub's `showAdsetOnly`); reuse `budget-modal.tsx` (import from `app/dashboard/components/budget-modal.tsx`).

### Reuse as-is (no change)
- `app/dashboard/components/budget-modal.tsx` (generic `BudgetTarget`).

### Delete
- None.

## Implementation Steps

1. **`api/tiktok/campaigns/[campaignId]/route.ts`** — mirror `app/api/campaigns/[campaignId]/route.ts`. Auth; 🔴 `requireRole(user.id, ['admin','leader'])` (Red Team Fix). Parse body `{action, advertiser_id, ...}`. Validate `advertiser_id` ∈ selected advertisers (service client). 🔴 Validate `campaignId` belongs to `advertiser_id` (lookup or confirmed API-side rejection — see Architecture note). `getValidAccessToken()`. Dispatch:
   - `pause` → `updateCampaignStatus(token, advertiser_id, [campaignId], 'DISABLE')`.
   - `enable` → `... 'ENABLE'`.
   - `budget` → 🔴 validate `Number.isFinite(amount) && amount > 0`; if `budget_mode === 'DAILY'`, enforce ≥ $50/day; if `budget_mode === 'LIFETIME'`, skip the flat minimum (dynamic, duration-dependent per research §4.4) and rely on TikTok's own rejection message, surfaced verbatim to the user → `updateCampaignBudget(token, advertiser_id, campaignId, amount)`.
   - Reconnect errors → 409; other TikTok errors → 502. Return `{success:true}`.
2. **`api/tiktok/adgroups/[adgroupId]/route.ts`** — same shape incl. 🔴 role gate + ownership check; ad-group DAILY min $20/day, LIFETIME min skipped per above; uses `updateAdGroupStatus`/`updateAdGroupBudget`.
3. **`tiktok-action-bar.tsx`** — mirror `action-bar.tsx`: show Pause when any selected `status==='ENABLE'`; Turn On when all `!=='ENABLE'`; Update budget for single selection with known budget. Build `BudgetTarget` from the row: `budget_type = budget_mode==='DAILY'?'daily':'lifetime'`, `daily_budget/lifetime_budget` from `budget` per mode, `entity_type:'campaign'`, `currency`, `vndRate:1`. PATCH per selected campaign (parallel, include `advertiser_id`). 🔴 On bulk pause/enable: after all PATCHes settle, diff the results against the original selection — if any failed, show "X of N failed to {pause/enable}: [list]" instead of a generic success toast; do not let a partial failure look like full success. On done → `onActionComplete()`. **No Duplicate button.**
4. **`tiktok-adgroup-flat-view.tsx`** — mirror `adset-flat-view.tsx` (drop snapshot-compare complexity — YAGNI for Plan 1; keep sortable columns + budget edit + selection + bulk on/off). Rows = `MergedTiktokAdGroup` + `campaign_name`. Budget edit → `budget-modal.tsx` with `entity_type:'adset'`. Bulk on/off → `/api/tiktok/adgroups/{id}` per selected.
5. **Ad-group fetch** — hub needs ad groups for the flat view: add `GET /api/tiktok/campaigns?level=adgroup` handling OR a small `fetchAdGroups`-backed branch in the campaigns route (planner: extend the Phase 3 route with an optional `?level=adgroup` that returns merged ad groups + `fetchTodaySpend(ADGROUP)` + Adjust adset maps). Merge Adjust by `adgroup_id` using `adset_id` from `AdjustRow` (Adjust exports adgroup_id_network → `adset_id`).
6. **Budget-min help text** — in the action bar / modal invocation, show "Min $50/day (campaign) / $20/day (ad group)" helper; client-side warn if below; server also validates (defense in depth).
7. **Wire into hub** — add action bar (sticky bottom) when `selectedIds.size>0`; add "Ad groups only" toggle to swap the table for the flat view (mirror FB `showAdsetOnly`).
8. **Compile + manual** — typecheck/build; test pause/enable/budget against a sandbox advertiser once Portal callback whitelisted (Phase 2 prereq).

## Todo List

- [ ] `app/api/tiktok/campaigns/[campaignId]/route.ts` (🔴 admin|leader gate, pause/enable/budget, advertiser + campaign-ownership validation, LIFETIME-aware budget min)
- [ ] `app/api/tiktok/adgroups/[adgroupId]/route.ts` (same at ad-group level)
- [ ] `tiktok-action-bar.tsx` (ENABLE/DISABLE mapping, budget-modal reuse, no Duplicate, 🔴 partial-failure reconciliation on bulk actions)
- [ ] `tiktok-adgroup-flat-view.tsx` (mirror adset-flat-view, budget + bulk on/off)
- [ ] Extend campaigns route with `?level=adgroup` (spend + Adjust adset merge)
- [ ] Budget-minimum inline validation/help ($50/$20 per day for DAILY mode; LIFETIME mode relies on TikTok's own rejection message — 🔴 no flat minimum applied)
- [ ] Wire action bar + ad-group toggle into `tiktok-campaign-hub.tsx`
- [ ] Typecheck/build; manual control test (post-whitelist)

## Success Criteria

- Selecting campaigns shows the action bar; Pause sets `DISABLE`, Turn On sets `ENABLE`, reflected after re-fetch.
- Budget edit updates the campaign/ad-group budget via TikTok API; below-minimum amounts are rejected/warned for `DAILY` mode; `LIFETIME` mode surfaces TikTok's own error rather than a false-positive local pass.
- Ad-group flat view lists ad groups with spend + ROAS and supports budget edit + bulk on/off.
- Bulk status on >100 selected items splits into ≤100-ID batches (no API rejection).
- Unauthorized advertiser_id in a PATCH body is rejected (403/400).
- 🔴 `staff`-role accounts get 403 from both PATCH routes (verified, not just coded).
- 🔴 A campaign_id that doesn't belong to the supplied advertiser_id is rejected, not silently forwarded to TikTok.
- 🔴 A bulk pause where one ID fails produces a visible "X of N failed" message, not a generic success toast.
- `budget-modal.tsx` reused unchanged; no new file > 200 lines.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Below-minimum budget rejected by TikTok mid-action | Medium | Medium | Client warn + server validate against $50/$20 DAILY minimums before call; LIFETIME mode skips flat check, surfaces TikTok error message |
| 🔴 Any authenticated `staff` account can pause/re-budget org-wide TikTok campaigns | ~~N/A~~ **was Critical, unaddressed** | ~~N/A~~ | Resolved: both PATCH routes now `requireRole(['admin','leader'])` |
| Wrong `advertiser_id` sent from client (spoofed) → acting on foreign account | Low | High | Server validates advertiser_id ∈ selected `tiktok_advertiser_accounts` |
| 🔴 Correct `advertiser_id` but mismatched `campaign_id` (cross-advertiser spoofing within the org's own accounts) | Low | Medium | Server validates campaign↔advertiser ownership before mutating |
| `budget_mode` mismatch (editing lifetime as daily) | Low | Medium | Derive `budget_type` strictly from row `budget_mode`; modal never offers switching |
| 🔴 LIFETIME budget incorrectly rejected/accepted by a flat DAILY-style minimum check | Medium | Medium | Minimum validation now branches on `budget_mode`; LIFETIME relies on TikTok's own error |
| Partial batch failure (some IDs fail) | Medium | **Medium** (🔴 was Low — this is a cost-control action; a silent partial pause means spend keeps running with the user believing it's stopped) | Action bar reconciles results against selection and surfaces explicit per-item failure, not a generic toast |
| Ad-group Adjust match key mismatch (adgroup_id vs adset_id) | Medium | Medium | Map Adjust `adset_id` (=adgroup_id_network) → `adgroup_id`; verify with a known ad group |
| Live control untestable until Portal whitelist | High (until fixed) | Medium | Manual prereq flagged; code reviewable independently |

## Security Considerations

- 🔴 Both PATCH routes require `requireRole(['admin','leader'])`, not just an authenticated session (Red Team Fix — TikTok's org-wide shared credential means "authenticated" alone was equivalent to giving every staff account org-wide spend control).
- `advertiser_id` validated against selected advertisers before any mutation; 🔴 `campaign_id`/`adgroup_id` ownership validated against that advertiser too.
- Tokens server-side only via `getValidAccessToken()`.
- Mutations are idempotent-ish (status/budget set to absolute values) — safe to retry.
- No secret/token in client bundles or responses.

## Next Steps

- Plan 1 complete after this phase. **Plan 2 (future):** duplicate-campaign (client-side orchestration — no native TikTok deep-copy) + creative/targeting/bidding wizard. Type shapes (`TiktokCampaignRow`/`TiktokAdGroupRow` storing fields separately) already accommodate Plan 2's create flow.
- Post-ship: update `docs/` changelog + journal per documentation rules.
