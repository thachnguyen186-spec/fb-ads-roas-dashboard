---
title: "Duplicate Campaign"
description: "Duplicate one campaign: same-account via FB API copy, cross-account via generated CSV for manual import"
status: pending
priority: P2
effort: 3.5h
branch: master
tags: [facebook-api, campaigns, duplicate, modal, csv-export]
created: 2026-04-15
---

# Duplicate Campaign

## Summary

Add a "Duplicate" button to the action bar (single-campaign only). Opens a modal with two flows:

- **Same-account**: User sets N copies (1-10) with custom names + optional budget overrides → app calls FB API (`POST /{id}/copies` with `deep_copy=true`) → fully automated, copies campaign + ad sets + ads.
- **Cross-account**: User edits the new campaign name + selects destination account → app fetches full campaign structure (campaign + ad sets + ads + creative details) → generates FB-format import CSV with IDs cleared → user downloads CSV and uploads to Facebook Ads Manager "Import Ads in Bulk" for destination account.

The cross-account CSV approach is intentional: Facebook's own import engine handles all creative migration correctly (no image re-upload complexity). This exactly mirrors what users do manually today.

## Data Flow

```
ActionBar (1 campaign selected)
  → Click "Duplicate"
  → DuplicateCampaignModal opens
    → User selects destination account
    
    IF same account:
      → Set copy count, names, budgets
      → POST /api/campaigns/[id] { action: 'duplicate', mode: 'same-account', copies: [...] }
        → FB API: POST /{id}/copies (deep_copy=true) per copy
        → PATCH each copy: set name + budget override
      → Success → re-fetch campaigns

    IF cross-account:
      → User sets new campaign name
      → GET /api/campaigns/[id]/export-csv?destAccountId=...
        → Fetch full structure: campaign + adsets + ads + creatives
        → Generate CSV in FB import format (IDs cleared, name replaced)
      → CSV downloaded to user's browser
      → Modal shows: "Download ready. Upload this CSV to [destination account] via Facebook Ads Manager → Import Ads in Bulk"
```

## Phases

| # | Phase | Status | Files | Effort |
|---|-------|--------|-------|--------|
| 1 | [Backend: API copy + CSV export route](./phase-01-backend-api.md) | Pending | `fb-client.ts`, `campaign-actions.ts`, `campaign-csv-export.ts` (new), `route.ts`, `export-csv/route.ts` (new) | 2h |
| 2 | [Frontend: Modal + ActionBar](./phase-02-frontend-modal.md) | Pending | `duplicate-campaign-modal.tsx` (new), `action-bar.tsx`, `campaign-hub.tsx` | 1.5h |

## Dependencies

- Phase 2 depends on Phase 1 (needs API routes)
- No external dependencies; no npm packages; no DB schema changes

## Failure Modes

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| FB copies API `deep_copy=true` takes too long (async) | Low | Medium | Return `copied_campaign_id` immediately; user sees PAUSED copy on re-fetch |
| Creative fields missing from FB API response | Medium | Medium | Include all known creative fields; gracefully omit missing columns in CSV |
| CSV column names mismatch FB import spec | Medium | High | Verify against FB's import template; note in success criteria |
| Token lacks `ads_read` for ads/creatives fetch | Low | High | Same token used for other reads; if fails, return error before CSV gen |

## Rollback

- Phase 1: Remove new files (`campaign-csv-export.ts`, `export-csv/route.ts`), revert `campaign-actions.ts`, `route.ts`
- Phase 2: Remove `duplicate-campaign-modal.tsx`, revert `action-bar.tsx` and `campaign-hub.tsx`
- No database migrations; no schema changes
