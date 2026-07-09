# Multi-Keyword Campaign Name Search

## Context
User problem: campaign names follow pattern `CTT 0907 NamDT` — a project code followed by a person-in-charge identifier appended later in the string. Single free-text search (`includes()`) can't express "must contain CTT 0907 AND must contain NamDT" since typing either alone only matches one term at a time.

## Overview
- Priority: high (blocks daily workflow — filtering campaigns by owner)
- Status: completed
- Fix: turn the campaign-name search box into a keyword-chip input. Typing text filters live (as today); pressing **Enter** locks the current text into a removable chip and clears the box for the next keyword. All locked chips + current live text are combined with **AND** substring matching.

## Key Insights (from research)
- Search input: [filter-bar.tsx:149-155](app/dashboard/components/filter-bar.tsx#L149-L155) — plain controlled `<input>`, no debounce.
- Match logic: [campaign-hub.tsx:402-405](app/dashboard/components/campaign-hub.tsx#L402-L405) — single-token case-insensitive `includes()` inside `filteredCampaignsBase` useMemo.
- Filtering is 100% client-side over `mergedCampaigns` state; no server/API search param exists ([app/api/campaigns/route.ts] only takes `viewAs`/date/`appSource`).
- Existing multi-value UI pattern: `AppMultiSelect` in [filter-bar.tsx:59-119](app/dashboard/components/filter-bar.tsx#L59-L119) — checkbox dropdown, OR semantics. Not directly reused (different interaction — chips-on-Enter fits a text search better than a checkbox dropdown), but confirms multi-value filter state (`string[]`) is an established pattern in this file (`appNameFilter`).
- No test framework in repo (`package.json` has only `dev`/`build`/`start`/`lint` — no `test` script, no Jest/Vitest/Playwright). Verification = `next build` (typecheck) + `eslint` + manual dev-server check.

## Requirements
- Typing in the search box still live-filters by that substring (unchanged behavior).
- Pressing Enter with non-empty text: adds it as a locked chip, clears the box, keeps focus.
- Duplicate keywords (case-insensitive) are not added twice.
- Each chip has a remove (×) button.
- Effective filter = campaign name must contain **all** locked chips **and** the current live text (AND, not OR) — case-insensitive substring match, same as today's single-term behavior.
- "Clear all" button and "Start Over" both reset chips too.
- No backend/API changes — stays client-side, consistent with current architecture.

## Architecture
Two-state design in `campaign-hub.tsx`:
- `campaignNameFilter: string` — existing state, now means "current (uncommitted) text in the box".
- `campaignNameKeywords: string[]` (new) — locked chips.
- `filteredCampaignsBase` combines both: `[...campaignNameKeywords, campaignNameFilter].filter(Boolean)`, then requires every entry to be a substring of `campaign_name` (lowercased).

`FilterBar` stays a pure controlled component: gains `campaignNameKeywords`, `onAddKeyword`, `onRemoveKeyword` props; owns the Enter-key/backspace-to-remove UX and chip rendering.

## Related Code Files
**Modify:**
- `app/dashboard/components/filter-bar.tsx` — Props interface, search input (`onKeyDown` handler), new chip row render, `hasActiveFilters` calc.
- `app/dashboard/components/campaign-hub.tsx` — new `campaignNameKeywords` state, `handleAddCampaignKeyword`/`handleRemoveCampaignKeyword` handlers, `filteredCampaignsBase` matching logic + deps array, `handleStartOver` reset, `onClearAll` reset, new props passed to `<FilterBar>`.

**No new files** (feature is small enough to live in the two existing components — YAGNI).

## Implementation Steps
1. `campaign-hub.tsx`: add `const [campaignNameKeywords, setCampaignNameKeywords] = useState<string[]>([]);` near existing `campaignNameFilter` state (line ~72).
2. Add two handlers near other handlers:
   ```ts
   function handleAddCampaignKeyword(raw: string) {
     const kw = raw.trim();
     if (!kw) return;
     setCampaignNameKeywords((prev) =>
       prev.some((k) => k.toLowerCase() === kw.toLowerCase()) ? prev : [...prev, kw]
     );
     setCampaignNameFilter('');
   }
   function handleRemoveCampaignKeyword(kw: string) {
     setCampaignNameKeywords((prev) => prev.filter((k) => k !== kw));
   }
   ```
3. Replace the name-filter block in `filteredCampaignsBase` (lines 402-405) with AND-match over locked keywords + live text; add `campaignNameKeywords` to the useMemo dependency array (line 430).
4. `handleStartOver()` (line ~130): add `setCampaignNameKeywords([]);`.
5. `onClearAll` callback on `<FilterBar>` (line ~798): add `setCampaignNameKeywords([]);`.
6. Pass new props to `<FilterBar>`: `campaignNameKeywords={campaignNameKeywords}`, `onAddKeyword={handleAddCampaignKeyword}`, `onRemoveKeyword={handleRemoveCampaignKeyword}`.
7. `filter-bar.tsx`: extend `Props` with `campaignNameKeywords: string[]`, `onAddKeyword: (v: string) => void`, `onRemoveKeyword: (v: string) => void`.
8. Search input: add `onKeyDown` — on `Enter` call `onAddKeyword(campaignName)` (parent clears the box); on `Backspace` with empty box and at least one chip, remove the last chip (quick-correction UX, standard for chip inputs).
9. Render locked chips: small pill row directly under/inside the search box wrapper (e.g. `flex flex-wrap gap-1 mt-1`), each chip = keyword text + `×` button calling `onRemoveKeyword`.
10. Update `hasActiveFilters` (line 137) to also check `campaignNameKeywords.length > 0`.

## Todo List
- [x] Add `campaignNameKeywords` state + handlers in campaign-hub.tsx
- [x] Update `filteredCampaignsBase` AND-match logic + deps
- [x] Reset chips in `handleStartOver` and `onClearAll`
- [x] Wire new props into `<FilterBar>`
- [x] Extend `FilterBar` Props + Enter/Backspace key handling
- [x] Render removable chip pills in FilterBar
- [x] Update `hasActiveFilters`
- [x] `next build` + `eslint` clean
- [x] Verification: logic equivalence check of AND-matching algorithm (manual dev-server verification substituted due to environment constraints)

## Success Criteria
- Typing "CTT 0907", pressing Enter, typing "NamDT" narrows the list to campaigns containing both substrings.
- Removing a chip widens results back immediately.
- "Clear all" / "Start Over" clear chips along with other filters.
- `next build` and `eslint` pass with no new errors.

## Risk Assessment
- Low risk: pure client-side, additive state, no API/schema changes. Main risk is UI clutter if many chips are added — mitigated by `flex-wrap` and small pill styling matching existing design language.

## Security Considerations
- None — client-side string filtering only, no new data exposure or injection surface (chip text only used in `.includes()`, not rendered as HTML/eval'd).

## Next Steps
- After approval: implement → `code-reviewer` review → manual dev-server verification (no automated test suite exists) → finalize (docs sync if warranted, commit on request).

**Verification Note:** Manual browser verification was substituted with standalone logic-equivalence check of the AND-matching algorithm against realistic campaign-name samples (passed). Browser automation tooling not available in environment, and `/dashboard` is auth-gated. Recommend real browser testing before production deployment.
