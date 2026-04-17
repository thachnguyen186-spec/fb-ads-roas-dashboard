---
title: "Multi-Account FB Ads Support"
description: "Replace single-account FB credentials with multi-account management via fb_accounts table"
status: pending
priority: P1
effort: 6h
branch: feat/multi-account-fb-ads
tags: [supabase, settings, dashboard, api]
created: 2026-04-14
---

# Multi-Account FB Ads Support

## Summary

Replace single FB account stored in `profiles` with a dedicated `fb_accounts` table supporting N accounts per user. Redesign settings page for CRUD, add token reveal with admin password, add account picker on dashboard.

## Data Flow

```
Settings Page                  API                         Supabase
─────────────                  ───                         ────────
Add account form  ──POST──→  /api/settings        ──insert──→ fb_accounts
Account list      ──GET───→  /api/settings        ──select──→ fb_accounts (no tokens)
Remove button     ──DELETE─→  /api/settings/[id]   ──delete──→ fb_accounts
Reveal button     ──POST──→  /api/settings/reveal  ──select──→ fb_accounts (returns token)

Dashboard
─────────
Account dropdown  ──GET───→  /api/settings        ──select──→ fb_accounts (no tokens)
Analyze click     ──GET───→  /api/campaigns?accountId=X ──select──→ fb_accounts → FB API
```

## Dependency Graph

```
Phase 1 (DB + Types) → Phase 2 (API Routes) → Phase 3 (Settings UI) → Phase 4 (Dashboard UI)
                                              ↗ Phase 3 and Phase 4 can parallelize after Phase 2
```

## Backwards Compatibility

- `profiles.fb_access_token` and `profiles.fb_ad_account_id` columns left in place (no migration needed)
- Phase 2 API routes replace old endpoints — settings page is the only consumer, updated in Phase 3
- Dashboard switches from `hasFbConfig: boolean` to `accounts: FbAccount[]` — coordinated in Phase 4
- Old data in profiles table ignored once new code deployed; can DROP columns later via separate migration

## Phases

| # | Phase | Files | Status |
|---|-------|-------|--------|
| 1 | [DB Schema + Types](./phase-01-db-schema-types.md) | schema.sql, lib/types.ts | Pending |
| 2 | [API Routes](./phase-02-api-routes.md) | 4 route files | Pending |
| 3 | [Settings Page Redesign](./phase-03-settings-page.md) | settings/page.tsx | Pending |
| 4 | [Dashboard Account Picker](./phase-04-dashboard-picker.md) | dashboard/page.tsx, campaign-hub.tsx | Pending |

## Rollback Plan

- Phase 1: DROP table fb_accounts, revert types.ts — no other code depends on it yet
- Phase 2: Revert route files to git HEAD — settings page still uses old API until Phase 3
- Phase 3: Revert settings/page.tsx — old page works with old API (Phase 2 must also revert)
- Phase 4: Revert dashboard files — old hasFbConfig flow still works with profiles table

## Test Matrix

| Layer | What | How |
|-------|------|-----|
| Unit | FbAccount type shape | TypeScript compiler |
| Integration | POST /api/settings creates account | API test with Supabase |
| Integration | DELETE /api/settings/[id] removes account | API test |
| Integration | POST /api/settings/reveal with wrong password → 403 | API test |
| Integration | POST /api/settings/reveal with correct password → token | API test |
| Integration | GET /api/campaigns?accountId=X loads correct credentials | API test |
| E2E | Add account → appears in list → appears in dashboard dropdown | Manual |
| E2E | Remove account → disappears from list and dropdown | Manual |
| E2E | Reveal token → password prompt → token shown | Manual |

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Token stored plaintext in fb_accounts | Low (same as current) | High | Accepted — same pattern as existing profiles table; encryption can be added later |
| ADMIN_PASSWORD env var not set | Medium | Medium | API returns 501 "Token reveal not configured" if env var missing |
| User deletes account while dashboard is open | Low | Low | Dashboard fetch returns 404, UI shows "account not found" message |
| RLS policy misconfigured | Low | High | Phase 1 includes explicit RLS policies; test with non-owner user |
