# TikTok Ads Tab Foundation — Phase 3 (Read-Only Dashboard) Complete

**Date**: 2026-07-18 23:40
**Severity**: Low (read-only view, no data mutation; cosmetic regression fixed same-session)
**Component**: TikTok integration / Dashboard UI
**Status**: Phase 3 Complete; Phase 4 (Budget Edit + On/Off Toggle) ready to start
**Commits**: 1 commit (dd86eef: 13 files, 905 insertions, 24 deletions)

## What Happened

Shipped Phase 3: TikTok dashboard tab with campaign list, spend, and Adjust revenue merge. The tab-switcher layout wraps both Facebook and TikTok dashboards with minimal coupling — each platform's component tree is structurally isolated (separate Next.js routes, zero cross-platform imports verified by grep-confirmed audit). API route fetches campaigns across selected advertisers with bounded-concurrency batching (max 3 parallel requests per advertiser-set, not unbounded fan-out) — this exact design pattern was a Critical Red Team finding from Phase 1 planning, now verified correctly implemented in code. Reused the existing FilterBar component cleanly by passing `appOptions=[]` to suppress the FB-specific multi-select, confirmed by code review to fully remove it from the DOM. Extracted `getInitials()` helper to lib/utils.ts (pure DRY cleanup, not a new function). Testing: typecheck + lint + build clean, smoke curl tests passed, pure-function edge cases validated. Code review: 9/10, all four applicable Red Team findings (#5 token-once/bounded-concurrency, #6 reporting-lag UX, #7 open read-access, #10 USD-only) verified correctly in code. One genuine cosmetic regression discovered (tab-switcher nav added ~40px un-budgeted height, stacking with both dashboards' `min-h-screen` root divs) — fixed same-session with `flex-1 overflow-y-auto` wrapper in layout.tsx. One minor process nit (FilterBar reuse needs in-code comment) also addressed same-session. Commits locally; nothing pushed yet.

## The Brutal Truth

Phase 1's red-team review forced us to design bounded-concurrency batching as a critical control for org-wide credentials (unbounded fan-out + per-advertiser token refresh would mean 50 simultaneous auth attempts for 50 advertisers, hitting rate-limits and cascading token-rotation collisions). Building Phase 3 without that discipline would have meant shipping a "works for 5 advertisers, silently fails for 50" system — the kind of slow-burn production issue that only manifests under specific scale, debug traces look nonsensical ("why did request 27 hang?"), and takes weeks to root-cause.

The independence guarantee matters because once this code ships, "pause a FB campaign" and "pause a TikTok campaign" cannot share any state. If we'd shared the same campaign-hub component or let TikTok import Facebook utilities, future refactorings become a minefield (merge a function, accidentally couple the tabs, deploy before noticing). Structural isolation is cheaper than hoping humans never introduce a cross-platform reference.

The cosmetic height regression was genuinely annoying — added a nav bar without accounting for the constraint that both dashboards already claim full viewport height. Fixing it required understanding that the tab-switcher needs to be the flex container, not a passive wrapper. That design choice (why flex-1 on the children, not an explicit height on the layout?) needs to be stable for Phase 4, which will add bulk-action toolbars to the TikTok hub.

## Technical Details

**Architecture**:
- **Tab-switcher layout** (`app/dashboard/layout.tsx`): routes to `/dashboard/facebook` or `/dashboard/tiktok` based on URL, wraps {children} in `flex flex-col` with tab pills in a header. Stateless by design — routing handles tab selection, not React state. Prevents accidentally loading both dashboards simultaneously.
- **Server component** (`app/dashboard/tiktok/page.tsx`): validates auth, fetches TikTok connection + selected advertiser IDs from DB, passes to client hub. No data fetch; those are delegated to the hub on mount.
- **Client hub** (`app/dashboard/tiktok/components/tiktok-campaign-hub.tsx`, 178 lines): renders FilterBar + TikTokCampaignTable, fetches campaigns on mount, wires search/filter state, displays loading/error UI.
- **Campaign table** (`tiktok-campaign-table.tsx`, 168 lines): renders header + scrollable campaign rows with spend + Adjust revenue columns.
- **Header row** (`tiktok-header.tsx`, 86 lines): column labels + currency notes ("TikTok native currency", "Adjust USD").
- **Filter predicate** (`lib/tiktok/filter-campaigns.ts`): pure function extracted from hub, testable without component tree.
- **API route** (`app/api/tiktok/campaigns/route.ts`, 147 lines): calls `getValidAccessToken()` once at start, batches advertiser IDs into chunks of 3, fetches campaigns per batch with `Promise.all()`, concatenates results. Bounded concurrency avoids per-advertiser token refresh storms.
- **Reuse pattern**: FilterBar receives `appOptions=[]` instead of `appOptions={all_facebook_apps}` — React doesn't render the multi-select div at all, no hidden CSS trap.

**Code Review Findings (1, fixed same-session)**:
1. **Cosmetic layout regression** (Medium): tab-switcher nav header + both dashboards' `min-h-screen` root divs produced ~40px overflow/stack. Fixed: wrapped layout's {children} in `flex-1 overflow-y-auto` to constrain the content area. Verified: both FB and TikTok dashboards now respect the constrained height without visual regression.

**Process Findings (1, fixed same-session)**:
1. **FilterBar reuse decision undocumented** (Low): code-reviewer flagged that the decision to reuse FilterBar instead of forking a TikTokFilterBar needed an in-code comment explaining why (prevents future devs from splitting it again). Added comment in hub:
   ```
   // Reuse FilterBar with appOptions=[] to avoid FB-specific UI (multi-app select).
   // Cleaner than forking; React doesn't render the hidden multi-select div.
   ```

**Verification**: 32 checks passed (same suite as Phase 1+2, extended for new files):
- Build: ✓ clean
- TypeScript: ✓ zero type errors
- ESLint: ✓ zero errors/warnings on new + modified files
- Pure function tests (edge cases for filter predicate): ✓ all pass
- Route smoke tests (GET `/api/tiktok/campaigns` + GET `/dashboard/tiktok`): ✓ 401 unauthenticated, 200 authenticated (mocked connection)
- File size audit (13 files): ✓ all < 200 lines (max: 178)
- Independence audit: ✓ grep-confirmed zero `lib/facebook` imports under `app/dashboard/tiktok/` or `lib/tiktok/`

## What We Tried

1. **Built per Phase 3 spec**: tab-switcher + server page + client hub + API route + table components, no scope creep.

2. **Reused instead of forked**: FilterBar component receives `appOptions=[]` to suppress FB UI. Simpler than duplicating the component tree; confirmed by code review to cleanly remove the multi-select from DOM.

3. **Extracted pure utilities**: `getInitials()` moved from duplicated FB hub code into lib/utils.ts, shared by both platforms.

4. **Bounded-concurrency API design**: advertiser batching with `Promise.all()` in 3-parallel chunks prevents token-refresh storms. Directly addresses Phase 1's Critical Red Team finding #5.

5. **Structural isolation verification**: grep audit confirmed zero cross-platform imports. Future refactorings cannot accidentally couple the tabs.

## Root Cause Analysis

**Why the cosmetic regression happened**: The tab-switcher layout was treated as a "thin header wrapper," but both dashboards had been built with the assumption they own the full viewport (`min-h-screen`). Adding a header above that consumed space without reducing the children's height budget. The fix required thinking of the layout as the flex container that *allocates* space to tabs + content, not as a passive frame around independent children.

**Why the code review found the issue**: Static code review alone wouldn't catch this — it only appears when running the component tree in a browser. Caught by tester's manual verification of tab switching.

**Why we didn't catch the FilterBar reuse pattern invisibly**: The code works correctly (React renders the right DOM), but future devs reading the code without the original rationale might assume the FilterBar is incomplete for TikTok and fork it. In-code comments prevent that second-guessing.

## Lessons Learned

1. **Bounded concurrency is non-negotiable for org-wide credentials**: This isn't a performance optimization — it's a stability requirement. If any future phase adds "webhook-triggered sync of all advertisers," batching must remain. Document it in code + commit message.

2. **Tab isolation is structural, not state-based**: Using separate Next.js routes (not a client-side tab toggle with shared state) ensures unmounting the previous platform's component tree prevents accidental lingering data loads or state leaks. This pattern should be the default for multi-platform UI.

3. **Component reuse patterns need explicit rationale**: Reusing FilterBar with `appOptions=[]` is clever but invisible. Future devs need to understand why we didn't fork. Comments are cheap.

4. **Layout regressions hide in the assumption phase**: When two subsystems both claim "full height," adding a header above them requires rethinking. This isn't caught by tests (no assertions on viewport height) — only by humans running the tab-switcher and scrolling.

5. **Cosmetic regressions are still regressions**: The ~40px overflow wasn't a functional bug, but it degraded the existing FB dashboard UX. Must be fixed same-session, not deferred. Code review caught it; tester verified the fix didn't break TikTok.

## Next Steps

1. **Immediate**: None. Phase 3 complete and committed locally.

2. **Phase 4 ready to start** (Budget Edit + On/Off Toggle):
   - Reuse existing `BudgetModal` component for campaign budget edit
   - Add campaign on/off toggle (radio or checkbox per campaign)
   - Wire bulk pause/enable actions with error reconciliation ("X of N paused successfully")
   - Estimated effort: 4-6h
   - Depends on Phase 3's hub + table (this phase provides the UI foundation)

3. **Verification gaps (carry-over from Phase 1, still blocked on live data)**:
   - Adjust `partner_name` string for TikTok traffic (hardcoded as `'tiktok'`, needs live export verification)
   - TikTok campaign ID format (assumed numeric-only, never verified against live IDs)
   - These do not block Phase 4 implementation, only TikTok revenue accuracy in production

4. **No docs updates needed**: This repo maintains only journal entries, no roadmap/changelog/architecture docs to sync.

## Unresolved Questions / Open Items

- Adjust `partner_name` for TikTok traffic (still best guess: `'tiktok'`, verification deferred to pre-production)
- TikTok campaign ID format (still assumed numeric, verification pending)
- Exact tab-switcher height budget for Phase 4 bulk-action toolbars (currently confirmed stable at flex-1 constraint; doc this before adding new UI elements)

**Files Modified/Created**: `app/dashboard/layout.tsx`, `app/dashboard/tiktok/page.tsx`, `app/dashboard/tiktok/components/tiktok-campaign-hub.tsx`, `app/dashboard/tiktok/components/tiktok-campaign-table.tsx`, `app/dashboard/tiktok/components/tiktok-header.tsx`, `app/api/tiktok/campaigns/route.ts`, `lib/tiktok/filter-campaigns.ts`, `lib/utils.ts` (getInitials added)

**Branch**: master (all changes committed locally, nothing pushed)
