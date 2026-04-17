# Phase 06 — Tool Hub Registration

## Context Links
- Tool Hub: `app/tools/page.tsx` (TOOLS array at lines 20-39)
- Existing tool entry shape (line 21-29 reference)

## Overview
- **Priority:** P2 (final, depends on phase 05)
- **Status:** completed
- **Description:** Add a new entry to the `TOOLS` array so the tool appears as a card in `/tools`.

## Key Insights
- TOOLS array is the single source of truth — only one file changes.
- No image asset is mandatory; placeholder renders a `Wrench` icon when `image: ''` (see `ToolCard` lines 99-104).
- `status: 'active'` makes the card clickable; `'coming-soon'` greys it out.
- `href` matches the route from phase 05.

## Requirements
- New TOOLS entry: `{ id, name, description, href: '/spending-limit-monitor', image: '' (or new png), status: 'active', badge: 'Live' }`.

## Architecture
Single-array mutation. No new components.

## Related Code Files
**Modify:**
- `app/tools/page.tsx`

**Create:** none mandatory. Optional: `public/images/spending-limit-monitor.png` for the card image.

## Implementation Steps

1. Insert a new entry in the `TOOLS` array between the existing two:
   ```typescript
   {
     id: 'spending-limit-monitor',
     name: 'Account Spending Limit Monitor',
     description: 'Track FB ad account spend caps in real time. Set per-account thresholds and get Telegram alerts when remaining budget runs low.',
     href: '/spending-limit-monitor',
     image: '',  // or '/images/spending-limit-monitor.png' if added
     status: 'active',
     badge: 'Live',
   },
   ```

2. (Optional) Add a card image at `public/images/spending-limit-monitor.png` (same aspect as `morphin-time.png`).

3. Smoke test: `npm run dev` → `/tools` → click new card → land on `/spending-limit-monitor`.

## Todo List
- [x] Add new entry to `TOOLS` array in `app/tools/page.tsx`
- [x] (Optional) Drop card image into `public/images/`
- [x] Verify card renders, click navigates to `/spending-limit-monitor`
- [x] `npx tsc --noEmit` passes
- [x] `npm run lint` passes

## Success Criteria
- Card visible in `/tools`.
- Card click → `/spending-limit-monitor` (HTTP 200, page renders).
- Existing tool cards unaffected.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Image path mismatch | Low | Low | Use empty string fallback for v1 |
| Insertion accidentally breaks existing JSX | Very Low | Low | Pure array literal change, TypeScript catches shape errors |

## Security Considerations
- None (purely presentational).

## Next Steps
- Plan complete. Run end-to-end test (set test threshold, wait for cron, confirm Telegram).
- After production deploy: monitor first 2-3 cron runs in Vercel logs to confirm behavior.
