---
title: "TikTok per-user connections"
description: "Convert TikTok Ads from one org-wide OAuth connection to per-user connections with FB-style visibility (staff own, leader team, admin all)."
status: in-progress
priority: P1
effort: 12h
branch: master
tags: [tiktok-api, oauth, rbac, migration, supabase]
created: 2026-10-12
---

# TikTok per-user connections

Every user (admin/leader/staff) connects their own TikTok account in Settings. Accounts are keyed `(advertiser_id, user_id)` like `fb_ad_accounts`. Visibility = `getVisibleUserIds` (staff self, leader self+team, admin all). Control (pause/enable/budget) = only advertisers the requester connected, using the requester's own token (mirrors FB `PATCH /api/campaigns/[id]`, which always uses the caller's token). Existing singleton row becomes the admin's (`connected_by`) personal connection; no reconnect.

## Locked decisions
- New tables `tiktok_connections` (PK user_id) + `tiktok_ad_accounts` (PK advertiser_id,user_id). Old `tiktok_connection` / `tiktok_advertiser_accounts` kept untouched until Phase 7 -> zero-downtime cutover + trivial rollback.
- Long-term tokens: null `token_expires_at` = never expires; refresh only when `refresh_token` exists (keep uncommitted fix in `tiktok-connection.ts`).
- Dashboard: single-user `?viewAs=` picker (FB parity), list = visible users who have a TikTok connection. Controls hidden while viewing someone else.
- Multi-user fan-out (accounting export, account-owners) dedupes by advertiser_id and calls each advertiser with an owner's own token.
- Tokens: service client only, RLS on with no policies, never in JSON.

## Phases

| # | Phase | Effort | Status | Blocked by |
|---|-------|--------|--------|------------|
| 1 | [SQL migration (additive)](./phase-01-sql-migration-per-user-tables.md) | 1h | code done, SQL run pending | - |
| 2 | [Per-user connection lib](./phase-02-per-user-connection-lib.md) | 2h | implemented, pending deploy test | 1 |
| 3 | [OAuth + accounts API + Settings card](./phase-03-oauth-accounts-api-and-settings-card.md) | 2h | implemented, pending deploy test | 2 |
| 4 | [Campaign read + control routes](./phase-04-campaign-read-and-control-routes.md) | 1.5h | implemented, pending deploy test | 2 |
| 5 | [Dashboard staff picker](./phase-05-dashboard-staff-picker.md) | 2.5h | implemented, pending deploy test (hub 201 lines, split open) | 2 (API contract of 4) |
| 6 | [Accounting export + account owners](./phase-06-accounting-export-and-account-owners.md) | 2h | implemented, pending deploy test | 2 |
| 7 | [Verify, drop old tables, docs](./phase-07-verify-cleanup-and-docs.md) | 1h | pending | 3,4,5,6 + soak |

Phases 3-6 can run in parallel: file sets are disjoint (see each phase's Related Code Files). Phase 5 only depends on Phase 4's contract (`GET /api/tiktok/campaigns?viewAs=<uid>[&level=adgroup]`), not its code.

## Deploy order
1. Run Phase 1 SQL in Supabase SQL editor (old code unaffected).
2. Merge + deploy Phases 2-6 together (one release; partial deploys mix table sets).
3. Manual test checklist (Phase 7). Soak >= 2 days.
4. Run Phase 7 cleanup SQL (drops old tables).

## Rollback
- Before step 4: redeploy previous commit; old tables still intact (changes made after cutover are lost to old code, acceptable). New tables can stay.
- After step 4: run reverse SQL in Phase 7 (recreate singleton from admin row), then redeploy old code.

## Compile / test
No automated suite. Gate per phase: `npx tsc --noEmit` + `npm run lint`; full manual matrix in Phase 7.

## Key files
`lib/tiktok/tiktok-connection.ts`, `app/api/tiktok/**`, `app/dashboard/tiktok/**`, `app/settings/{page,tiktok-connection-card}.tsx`, `app/api/accounting-export/route.ts`, `app/api/account-owners/route.ts`, `supabase/schema.sql`, `lib/types.ts`, `lib/auth-guards.ts` (read-only reuse).

Prior plan: [260718-1343-tiktok-ads-tab-foundation](../260718-1343-tiktok-ads-tab-foundation/plan.md)
