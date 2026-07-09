# Code Review: Multi-Keyword Campaign Name Search

Scope: uncommitted diff in `app/dashboard/components/filter-bar.tsx` + `app/dashboard/components/campaign-hub.tsx`
Plan: `plans/260709-0841-multi-keyword-campaign-search/plan.md`
Verified: `tsc --noEmit` clean; `eslint` on both files → 0 errors, 1 pre-existing warning at campaign-hub.tsx:546 (`react-hooks/exhaustive-deps`, outside this diff — out of scope).

## Overall Assessment
Small, additive, matches plan exactly. AND-match logic, dedup, and all three reset sites (`handleStartOver`, `handleAddCampaignKeyword`'s own clear, `onClearAll`) are correct. No XSS risk, no other `campaignNameFilter` call sites missed (grepped repo-wide — only these two files reference it). No critical or high issues.

## Findings

### Medium
None.

### Low
1. **Enter on whitespace-only text doesn't clear the box** — `filter-bar.tsx:162` / `campaign-hub.tsx:144-151`. `handleAddCampaignKeyword` does `raw.trim()`, and if empty, returns before `setCampaignNameFilter('')` runs. Filtering correctness is unaffected (whitespace-only tokens are stripped by `.filter(Boolean)` in the `useMemo` too), but pressing Enter on a box containing only spaces silently does nothing instead of clearing it. Minor UX inconsistency, not a bug. Fix if desired: move `setCampaignNameFilter('')` outside the early-return, or trim in the input's own state.

2. **IME composition not guarded** — `filter-bar.tsx:159-166`. The `onKeyDown` Enter handler doesn't check `e.nativeEvent.isComposing` (or `e.keyCode === 229`). For CJK input methods, the "confirm conversion" Enter keystroke also fires a `keydown` with `key === 'Enter'` in some browsers, which would prematurely lock a partially-composed keyword. Low real-world risk given the target usage (Vietnamese campaign codes typed via OS-level IME, not browser composition events), but worth a one-line guard if this dashboard is ever used by CJK-input staff. Not blocking.

3. **Duplicate-looking chips via whitespace variants** — `campaign-hub.tsx:144-151`. Dedup check is case-insensitive but not whitespace-normalized beyond outer `trim()`. `"CTT  0907"` (double space) and `"CTT 0907"` (single space) are treated as distinct keywords, producing two near-identical chips. Cosmetic edge case, not a correctness bug (both still filter correctly, just redundant UI).

## Verified Correct (per review checklist)
- **AND-match logic** (`campaign-hub.tsx:416-426`): combines `campaignNameKeywords` + live `campaignNameFilter`, trims + lowercases each, filters empties via `Boolean`, requires `.every()` substring match — correct case-insensitive AND semantics.
- **useMemo deps** (`campaign-hub.tsx:451`): both `campaignNameFilter` and `campaignNameKeywords` present — no stale-closure risk.
- **Duplicate prevention** (`campaign-hub.tsx:147-148`): `k.toLowerCase() === kw.toLowerCase()` — correct.
- **State reset completeness**: `handleStartOver` (line 133), `onClearAll` (line 823), and the keyword-add handler's own `setCampaignNameFilter('')` (line 150) all correctly reset. Repo-wide grep confirms no other component reads `campaignNameFilter`/`campaignNameKeywords`, so no missed reset sites.
- **Keyboard handling**: Enter → `preventDefault()` + add; Backspace-when-empty → remove last chip, guarded by `campaignNameKeywords.length > 0` before the non-null assertion (safe). No wrapping `<form>` exists, so `preventDefault()` on Enter is precautionary but harmless.
- **Chip rendering**: `key={kw}` is stable and collision-free (dedup guarantees uniqueness); `aria-label="Remove keyword {kw}"` present on the remove button; keyword rendered as JSX text child (React-escaped), not `dangerouslySetInnerHTML` — no XSS surface.
- **Other `campaignNameFilter` usages**: none outside the two files in this diff (`FilterBar` also has exactly one call site).
- **YAGNI/KISS**: no new files, no unnecessary abstraction — two small handlers + inline chip render, consistent with existing `appNameFilter`/`AppMultiSelect` pattern in the same file.

## Recommended Actions
None blocking. Optional polish (low priority, can ship as-is):
1. Clear the input box even when Enter is pressed on whitespace-only text.
2. Add `isComposing` guard on the Enter handler if CJK input support becomes a requirement.

## Unresolved Questions
None.
