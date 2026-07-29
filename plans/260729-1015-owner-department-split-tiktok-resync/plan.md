---
title: "Split Owner/Department + TikTok Account Name Resync"
description: "Two follow-up fixes to the Accounting Export tool: split the combined owner_label into separate Owner + Department fields; add a non-destructive way to refresh stale TikTok advertiser names."
status: completed (code complete; 2 manual Supabase steps — department_label column + upsert_account_owner_label function — are outstanding)
priority: P1
effort: 3h
branch: master
tags: [accounting, tiktok, bugfix, follow-up]
created: 2026-07-29
---

# Split Owner/Department + TikTok Account Name Resync

Two user-reported issues after shipping the Accounting Export tool (`plans/260728-0748-accounting-spend-export/`):

1. **Owner and Department must be two separate fields**, not one combined free-text label. The original design conflated "group account name to different person-in-charge **or** department" into a single `owner_label`. The user now wants both tracked independently per account.
2. **TikTok accounts show raw advertiser IDs instead of names** in the export. Root cause investigated: `/advertiser/info/` was rejecting the whole enrichment call for orgs with >100 advertisers ("Length must be between 1 and 100"), silently falling back to id-as-name for every account. This was already fixed in commit `2aed53f` (2026-07-22, chunks the call at 100/batch) — **but only for future syncs**. The already-stored rows still have the stale `name = advertiser_id` values from before the fix, and `syncAdvertiserAccounts` only runs during OAuth connect/reconnect. There's no way to refresh names without disconnecting (which wipes every `is_selected` account choice too — a much bigger action than the user needs).

## Fix 1: Split `owner_label` → `owner_label` + `department_label`

### Data flow
```
account_owners (DB): add department_label text not null default ''
  ↓
AccountingExportRow / AccountOwnerEntry (types): add department_label: string
  ↓
GET /api/account-owners → includes department_label per account
PATCH /api/account-owners → body accepts owner_label?, department_label? (either/both,
  partial update — read existing row, merge provided fields, upsert; a client editing only
  one field must never blank out the other)
  ↓
lib/accounting/build-rows.ts: ownerMap value becomes {owner_label, department_label}
  (was a bare string) — buildFbRows/buildTiktokRows populate both columns per row
  ↓
UI:
  - grouping-manager.tsx: two separate inline-editable inputs per row (Owner, Department)
  - results-table.tsx: "Owner/Department" column → split into "Owner" + "Department" columns;
    "Group by owner" boolean toggle → "Group by: None / Owner / Department" select
  - export-filter-bar.tsx: one owner dropdown → separate Owner + Department dropdowns
  - lib/accounting/export-csv.ts: "Owner/Department" CSV column → "Owner" + "Department"
```

### Files
**Modify:**
- `supabase/schema.sql` — add `department_label` column
- `lib/types.ts` — `AccountingExportRow`, `AccountOwnerEntry` gain `department_label: string`
- `app/api/account-owners/route.ts` — GET returns department_label; PATCH does a partial read-merge-upsert instead of a blind overwrite
- `app/api/accounting-export/route.ts` — ownerMap changes from `Map<string,string>` to `Map<string,{owner_label,department_label}>`
- `lib/accounting/build-rows.ts` — `buildFbRows`/`buildTiktokRows` read both fields from the new map shape
- `lib/accounting/export-csv.ts` — split CSV column
- `app/accounting-export/components/grouping-manager.tsx` — two inputs per row
- `app/accounting-export/components/results-table.tsx` — two columns; groupBy becomes a 3-way select
- `app/accounting-export/components/export-filter-bar.tsx` — two filter dropdowns; groupBy control
- `app/accounting-export/components/accounting-export-hub.tsx` — filters state gains `departmentFilter`; `groupByOwner: boolean` → `groupBy: 'none'|'owner'|'department'`

### Key decision: PATCH partial-update semantics
Client sends only the field(s) actually edited (e.g. blur on the Owner input sends `{account_id, platform, owner_label}`, no `department_label` key). Server: `select` the existing row first (if any); for each of `owner_label`/`department_label`, use the request value if the key is present, else fall back to the existing DB value (or `''` for a brand-new row). Then upsert. This avoids a client blanking out the sibling field it never touched — a real risk if the two inputs fire independent PATCH calls (they do, per the inline-edit pattern already established).

### No DB migration needed beyond one `alter table` — additive, backward compatible (existing `owner_label` values are untouched; every row's `department_label` defaults to `''`).

## Fix 2: Non-destructive TikTok advertiser-name resync

### Data flow
```
Settings → TikTok card → "Resync names" button (admin/leader, visible when connected)
  ↓ PATCH /api/tiktok/accounts { action: 'resync_names' }
  ↓ getValidAccessToken() (existing org-wide token, no new OAuth round-trip)
  ↓ read current tiktok_advertiser_accounts.advertiser_id list
  ↓ fetchAdvertiserInfo(ids, token) — EXTRACTED from oauth/callback/route.ts into a shared
    lib/tiktok/advertiser-info.ts module (same chunked-at-100 call, same id-as-name fallback,
    same diagnostic console.warn on missing fields — no behavior change, just DRY reuse)
  ↓ upsert { advertiser_id, name, currency } per row — is_selected omitted (existing rows keep
    their current selection, exactly like syncAdvertiserAccounts already does)
  ↓ Response { updated: N }
  ↓ Card refetches /api/tiktok/accounts, shows "Refreshed N account names" banner
```

### Files
**Create:**
- `lib/tiktok/advertiser-info.ts` — `fetchAdvertiserInfo(advertiserIds, token)`, extracted verbatim from `app/api/tiktok/oauth/callback/route.ts` (same chunk-at-100 logic, same fallback/logging)

**Modify:**
- `app/api/tiktok/oauth/callback/route.ts` — import `fetchAdvertiserInfo` from the new module instead of defining it locally; no behavior change
- `app/api/tiktok/accounts/route.ts` — PATCH gains `action: 'resync_names'` branch (admin/leader gate, same as the existing toggle action — not admin-only like disconnect, since this is non-destructive)
- `app/settings/tiktok-connection-card.tsx` — "Resync names" button next to Disconnect; calls the new action, refetches accounts, shows a result banner

### Why not just tell the user to disconnect/reconnect
Disconnect wipes `is_selected` for every advertiser (confirmed in `handleDisconnect()` — deletes all `tiktok_advertiser_accounts` rows). For an org with 100+ accounts, re-selecting which ones feed the dashboard by hand is a real cost. A resync-only action reuses the same enrichment call without touching selection state.

## Implementation Summary

**Status:** Code complete. Both fixes fully implemented and verified.

**Files modified/created:**

*Fix 1 (owner/department split):*
- `supabase/schema.sql` — added `department_label` column to `account_owners`
- `lib/types.ts` — added `department_label: string` to `AccountingExportRow` and `AccountOwnerEntry`
- `app/api/account-owners/route.ts` — GET returns department_label; PATCH uses atomic RPC (see design change below)
- `app/api/accounting-export/route.ts` — ownerMap signature changed from `Map<string, string>` to `Map<string, {owner_label, department_label}>`
- `lib/accounting/build-rows.ts` — reads both owner_label and department_label from the new map shape
- `lib/accounting/export-csv.ts` — split "Owner/Department" CSV column into "Owner" + "Department"
- `app/accounting-export/components/grouping-manager.tsx` — two separate inline-editable inputs per row
- `app/accounting-export/components/results-table.tsx` — two columns; groupBy becomes a 3-way select (None/Owner/Department)
- `app/accounting-export/components/export-filter-bar.tsx` — separate Owner + Department filter dropdowns
- `app/accounting-export/components/accounting-export-hub.tsx` — filters state gains `departmentFilter`; `groupByOwner: boolean` → `groupBy: 'none'|'owner'|'department'`

*Fix 2 (TikTok resync):*
- `lib/tiktok/advertiser-info.ts` — new shared module, extracted `fetchAdvertiserInfo(advertiserIds, token)` from oauth/callback/route.ts (same chunked-at-100 logic, same fallback/logging, no behavior change)
- `app/api/tiktok/oauth/callback/route.ts` — imports `fetchAdvertiserInfo` from the new module (byte-for-byte equivalent extraction, no logic drift)
- `app/api/tiktok/accounts/route.ts` — PATCH gains `action: 'resync_names'` branch (admin/leader gate)
- `app/settings/tiktok-connection-card.tsx` — "Resync names" button added; calls the new action, refetches accounts, shows result banner

**Design change:** Original plan proposed a "read-merge-upsert" sequence in the API route for Fix 1. Code review identified two real bugs: (1) silent data loss if both fields submitted in rapid succession, and (2) TOCTOU race between read and upsert. **Replaced with atomic Postgres RPC function** `upsert_account_owner_label()` in `supabase/schema.sql`, using `ON CONFLICT ... DO UPDATE SET col = COALESCE($new, table.col)` to handle partial updates atomically — preserves untouched fields and eliminates the race window entirely. Tester verified the RPC logic across three scenarios (new row, partial update, both fields at once) independently.

**Quality checks:**
- Typecheck: `npx tsc --noEmit` — passed
- Lint: `npm run lint` — passed
- Production build: `npm run build` — passed
- Code review verified byte-for-byte extraction equivalence (Fix 2) and RPC correctness (Fix 1)

**Outstanding manual steps (not blockers for merge):**
1. **Add `department_label` column:** In the Supabase SQL editor, run the `ALTER TABLE account_owners ADD COLUMN department_label TEXT NOT NULL DEFAULT '';` statement from `supabase/schema.sql` (idempotent via `IF NOT EXISTS` pattern)
2. **Create RPC function:** In the Supabase SQL editor, run the `CREATE OR REPLACE FUNCTION upsert_account_owner_label(...)` definition from `supabase/schema.sql` (replaces any prior version; idempotent)

Both statements are present in the schema.sql file and follow the repo's standard "manual schema-change convention" (same as Phase 01 of the sibling Accounting Export tool plan).

## Success Criteria
1. `account_owners` has independent `owner_label` and `department_label`; editing one in the UI never clears the other.
2. Results table, filter bar, and CSV all show Owner and Department as distinct columns/filters.
3. Group-by extends to Owner or Department (single dimension at a time — no nested grouping, YAGNI).
4. "Resync names" button refreshes stale TikTok advertiser names without touching `is_selected` or requiring reconnect.
5. `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean.

## Risk Assessment
| Risk | Mitigation |
|------|-----------|
| PATCH blanking the untouched field on partial edits | Read-merge-upsert semantics (see Fix 1 key decision) |
| Resync silently fails again for >100 accounts | Reuses the already-fixed, already-tested chunking logic verbatim — no new risk surface |
| Two owner_label consumers (route + build-rows) get out of sync on the map-shape change | Single-pass edit across both files in the same session, typecheck catches any mismatch |

## Unresolved Questions
None — both fixes are direct, well-scoped extensions of code from the immediately prior session.
