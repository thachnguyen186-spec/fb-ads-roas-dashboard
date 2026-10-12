# TikTok Ads: Per-User Connections (Plan 261012-1101)

**Date**: 2026-10-12
**Status**: Code implemented (Phases 2-6), uncommitted. Phase 1 SQL run pending. Deploy and manual test matrix pending (Phase 7).

## Why

- TikTok was one org-wide singleton connection. Any admin/leader could control every advertiser in the org. Staff could not connect at all.
- Long-term token bug (root cause): Marketing API tokens have no expiry and no `refresh_token`. The code guessed a 24h expiry, then tried to refresh with `grant_type=refresh_token`, which fails with `auth_code: Missing data`. Fix: null `token_expires_at` means never expires; refresh only when a `refresh_token` exists.

## What Changed

- New tables `tiktok_connections` (PK user_id) and `tiktok_ad_accounts` (PK advertiser_id, user_id). Old tables kept until cleanup, so cutover is zero-downtime and rollback is trivial.
- Phase 1 SQL copies the singleton into the admin's personal rows (`connected_by`). No reconnect needed.
- Every user connects their own TikTok account in Settings. Role gates removed from OAuth and accounts routes. OAuth state cookie is bound to the user id.
- Visibility follows FB rules via `getVisibleUserIds` / `canViewAs`: staff self, leader self plus team, admin all.
- Control routes (pause, enable, budget) only work on advertisers the caller connected and selected, using the caller's own token. Mirrors FB.
- Dashboard: `?viewAs=` picker for leader/admin. Viewing someone else is read-only.
- Accounting export and account-owners: scoped to visible users, deduped by advertiser_id, each advertiser fetched with an owner's own token.

## Review Fixes

Code review: `plans/reports/code-reviewer-261012-1127-tiktok-per-user-connections.md`.

- H1: re-running `schema.sql` could resurrect a disconnected token. Fixed with run-once marker `migrated_per_user_at`.
- M1: picker switch mid-fetch showed the wrong user's data. Fixed with a fetch sequence guard.
- M2: export failed when the first owner's token was revoked. Fixed: tries the other owners' tokens in order.
- M3: sync ignored a stored-row read error and overwrote currency with USD. Fixed: throws on error.
- L1: DB errors were treated as "not connected". Fixed.
- L2: fresh connect kept a stale `refresh_token`. Fixed.

## Remaining Steps

1. Run Phase 1 SQL in Supabase (twice, to prove idempotency).
2. Merge and deploy Phases 2-6 together.
3. Run the Phase 7 manual test matrix (21 tests). Soak at least 2 days.
4. Run Phase 7 cleanup SQL (drops old tables).
5. Split `tiktok-campaign-hub.tsx` (201 lines, over the 200-line rule).

## Open Items (review, not fixed)

- L3: auth error copy says "Connect in Settings" when viewing others. Export warnings show raw user uuid.
- L4: DB errors return empty lists in a few GETs.
- L5: callback returns a raw 401 when session expired.
- L6: `listUsers` cap of 200 (existing pattern).
- L7: no Reconnect button while connected (picking up new advertisers needs Disconnect).
