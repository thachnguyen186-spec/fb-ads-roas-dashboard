# Code Review: Owner/Department Split + TikTok Advertiser Name Resync

Scope: uncommitted changes on top of `0ccc49a`. Plan: `plans/260729-1015-owner-department-split-tiktok-resync/plan.md`.

## Score: 7/10

Both fixes are well-scoped, closely follow the plan, and the TikTok extraction is genuinely verbatim. But the PATCH `/api/account-owners` read-merge-upsert — the one piece of logic the whole Fix 1 exists to get right — has two concrete gaps that undermine its "never blank the sibling field" guarantee. Everything else (gating, types, CSV injection guard, file sizes) checks out.

## Critical

**1. `app/api/account-owners/route.ts` PATCH — unchecked error on the pre-read silently blanks the untouched field on a transient DB failure.**

```ts
const { data: existing } = await service
  .from('account_owners')
  .select('owner_label,department_label')
  .eq('account_id', account_id)
  .eq('platform', platform)
  .maybeSingle();
const existingRow = existing as { owner_label: string; department_label: string } | null;
```

`error` is discarded. On a genuine row-not-found, `data` is `null` and this is correct (new row → default `''`). But if the SELECT itself fails (transient Supabase/network error, connection pool exhaustion, etc.), `data` is *also* `null` with `error` populated — indistinguishable from "no existing row" in this code. Result: a client that PATCHes only `owner_label` for an account that already has a non-empty `department_label` will silently overwrite `department_label` back to `''`, and the request still returns `200 { ok: true, ... }`. No error surfaced, financial-adjacent metadata quietly lost.

This is meaningfully different from the other unchecked-`data` reads later in the same function (FB visibility check, TikTok existence check) — those fail *closed* (403/404, reject the whole request) on `!data`. This one fails *open*: on read failure it still proceeds to write, using an incomplete merge. Given the entire point of this endpoint redesign is "an edit to one field must never blank the sibling field," this is the one failure path that defeats that guarantee.

Fix: check `error` on the pre-read and `return errorResponse(...)` (502-style, same pattern already used by `resolveVisibleIds` in this file) instead of falling through with `existingRow = null`.

**2. Same file — TOCTOU race between the two independent PATCH calls the UI now fires per row.**

`grouping-manager.tsx`'s `LabelCell` fires one PATCH per field, on blur (confirmed — two separate `commit()` closures, one bound to `field="owner_label"`, one to `field="department_label"`, same row). If a user edits both fields for the same account close together (tab from Owner to Department and blur both within the round-trip time of the first request), both requests can read the same pre-edit `existing` row before either has written back. Whichever upsert commits second will overwrite the row using its own (now-stale) view of the sibling field, silently reverting the first edit — the exact symptom the read-merge-upsert was built to prevent, just triggered by concurrency instead of a DB error.

The read-merge-upsert is not atomic (`SELECT` then `UPSERT` are two round-trips with no locking/version check between them), so this isn't a corner case introduced by a bug — it's structurally unavoidable with this pattern under concurrent requests to the same `(account_id, platform)` row.

Fix options (pick one, don't need both):
- Server: replace with a single atomic upsert using `COALESCE` against the existing row, e.g. an RPC/raw SQL `INSERT ... ON CONFLICT (account_id, platform) DO UPDATE SET owner_label = COALESCE($owner, account_owners.owner_label), department_label = COALESCE($dept, account_owners.department_label)` — no separate read needed at all, and this also fixes Critical #1 for free (no more silent fallback on read failure since there's no separate read).
- Client: serialize the two PATCH calls per row (e.g., a tiny per-`account_id:platform` request queue in `grouping-manager.tsx`) so the second field's blur always waits for the first field's in-flight PATCH to resolve before firing.

The atomic-SQL option is strictly better since it also closes gap #1, and it's a small, self-contained change (one RPC function or raw query) — recommend that over a client-side queue.

## Warnings

**3. `app/settings/tiktok-connection-card.tsx` is now 214 lines** (was ~160 before, per dev-rules ~200-line guidance). Not urgent — mostly one added button + handler — but if this card grows again it's a candidate to extract `handleResyncNames` + the resync banner UI into a small sub-component.

**4. `app/api/accounting-export/route.ts` sits exactly at 200 lines.** No action needed now, just noting it's at the line-count guidance boundary for the next time this file is touched.

## Verified correct (no issues)

- **PATCH merge logic — the three specific scenarios requested:**
  - Brand-new `account_id`/`platform` pair: `existing` is `null` → both fields correctly default via `existingRow?.field ?? ''`, only the field present in the body gets a non-default value.
  - Existing row, partial update: correctly preserves the omitted field's stored value (assuming the pre-read succeeds — see Critical #1).
  - Neither `owner_label` nor `department_label` present: 400 returned before any DB access, correct.
- **Fix 2 extraction (`lib/tiktok/advertiser-info.ts`)**: diffed against the removed code in `oauth/callback/route.ts` — byte-for-byte logic identical (chunk-at-100 via existing `chunk()` util, id-as-name / `'USD'` fallback, same diagnostic `console.warn`/`console.error` calls). Only the extraction comment text changed. No behavior drift.
- **`is_selected` omission in `handleResyncNames()`** (`app/api/tiktok/accounts/route.ts`): upsert row shape (`advertiser_id, name, currency`) matches `syncAdvertiserAccounts()` in the OAuth callback exactly — `is_selected` genuinely omitted from both, so existing selections survive a resync.
- **Resync gating**: `requireRole(user.id, ['admin', 'leader'])` runs before the `action === 'resync_names'` branch in the PATCH handler — correctly admin/leader, not admin-only (that gate is reserved for `disconnect`). Settings page (`app/settings/page.tsx:220`) only renders `TiktokConnectionCard` for `role === 'admin' || role === 'leader'` at all, and the button itself has no additional role check inside the card — consistent, no staff/admin-only mismatch either direction.
- **CSV injection guard**: `department_label` is user-editable free text flowing through the same `csvCell()` formula-injection guard as `owner_label` in `lib/accounting/export-csv.ts` — no gap reintroduced for the new column (see prior memory note on this codebase's CSV injection history).
- **Type safety**: no `any`/unsafe-cast additions in the diff; the one runtime cast pattern (`existing as {...} | null`) mirrors the pre-existing style already used elsewhere in this same file (`OwnerRow` cast in `GET`), not a new anti-pattern.
- **`build-rows.ts` / `accounting-export/route.ts` map-shape change** (`Map<string,string>` → `Map<string,OwnerLabels>`): both call sites (`fbLeg`, `tiktokLeg`, `buildFbRows`, `buildTiktokRows`) updated consistently; grep across the repo confirms no leftover single-field `owner_label`-only consumer.
- **Frontend wiring**: `accounting-export-hub.tsx`'s `groupBy: 'none'|'owner'|'department'` replaces the old boolean cleanly, `ownerFilter`/`departmentFilter` are independent and both correctly included in the `filteredRows` memo dependency array, `handleLabelChanged` updates only the targeted field per row.
- **Schema migration**: additive `alter table ... add column if not exists department_label text not null default ''` — backward compatible, no length-constraint mismatch with the app-level 120-char cap in `normalizeLabel()`.

## Unresolved Questions

- None on scope. Worth confirming with the user whether the narrow-window race in Critical #2 is an acceptable residual risk for v1 (single admin/leader editing one row at a time is the common case) or whether it should block landing — the plan's risk table lists this as "mitigated" but the mitigation is incomplete under true concurrency.
