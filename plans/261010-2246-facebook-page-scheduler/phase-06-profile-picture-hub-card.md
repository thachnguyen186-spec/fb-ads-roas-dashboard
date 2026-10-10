# Phase 06 — Profile picture, Tool Hub card, polish

## Context Links
- `app/tools/page.tsx` (`TOOLS` array; cards: It's Cooking Time, Spending Limit Monitor, Accounting Export, AFS Niche Testing)
- Phase 02 `pages-table.tsx`, `getPageToken` · Phase 03 `media-storage.ts` (signed upload/sign URL) · Phase 00 step 13

## Overview
- Priority: P3 (nice to have) + P1 (card) · Status: Implemented — pending live verification (picture change on test Page; journal pending) · Effort: 2h · Depends: 02 (picture), 04 (card should ship once push works)
- Per-page "Change picture" action; Tool Hub card; final docs/journal.

## Key Insights
- `POST /{page-id}/picture` with `picture=<url>` needs the `MANAGE` task; FB fetches URL immediately -> 10-min Supabase signed URL is enough (spike step 13 confirms).
- Image travels browser -> Storage (signed upload) -> FB via signed URL; no large route-handler body.
- Page-level country restriction: no API -> NOT implemented; Settings shows note "set in Page settings UI".

## Requirements
- Functional: button only on own pages (hidden for team pages viewed by leader/admin) and enabled only when page `tasks` include `MANAGE`; accept jpg/png <=4 MB (png <=1 MB), preview, confirm; on success refresh page `picture_url` (re-read `GET /{page}?fields=picture{url}`).
- Card: id `page-scheduler`, name "Page Scheduler", description "Bulk-schedule posts to many Facebook Pages from CSV/JSON, tier-1 geo targeting, profile pictures and engagement analytics.", href `/page-scheduler`, image `''`, badge `Live`, visible to all roles.
- Non-functional: owner-only action; no token exposure.

## Architecture
```
Browser: pick file -> POST /api/page-scheduler/pages/{pageId}/picture {action:'sign', name, size, type}
         -> {path: ps/{user}/avatars/{pageId}-{ts}.{ext}, token} -> uploadToSignedUrl
         -> POST same route {action:'apply', path}
Server apply: verify path prefix ps/{user}/avatars/{pageId}- ; page owned, active, MANAGE task
         -> signUrl(path, 600s) -> fbPostForm(/{pageId}/picture, {picture: url}, pageToken, v26)
         -> GET /{pageId}?fields=picture{url} -> update ps_pages.picture_url -> {picture_url}
         errors classified (190 -> markProfileInvalid)
```

## Related Code Files
- Create: `lib/page-scheduler/page-picture.ts`, `app/api/page-scheduler/pages/[pageId]/picture/route.ts`, `app/page-scheduler/components/change-picture-dialog.tsx`
- Modify: `app/page-scheduler/components/pages-table.tsx` (button + dialog), `app/tools/page.tsx` (append card), `docs/journals/` (new journal entry via journal-writer/docs-manager)
- Delete: none

## Implementation Steps
1. `page-picture.ts` (`applyPagePicture(userId, pageId, path)`).
2. Route with `action` switch; validate size/type/ext server-side on sign; path generated server-side.
3. Dialog + table button (disabled with tooltip when no MANAGE).
4. Add Tool Hub card.
5. Polish: empty states (no profiles -> CTA to Settings), Bangkok time hint, spam warning copy, link to templates, prerequisite help (app role, extended token).
6. typecheck/lint/build; manual change on test Page.

## Todo List
- [x] page-picture lib + route
- [x] dialog + table button
- [x] Tool Hub card
- [x] polish items (empty-state CTA, Bangkok hint, spam copy, prerequisite help)
- [ ] journal

## Success Criteria
- Picture changes on test Page within one action; table thumbnail updates.
- Page without MANAGE: button disabled; forged API call -> 403.
- Card visible for admin/leader/staff; opens `/page-scheduler`.

## Risk Assessment
| Risk | L x I | Mitigation |
|---|---|---|
| FB rejects signed URL (redirect/headers) | L x M | Fallback: upload via `/{page}/photos published=false` then `photo=<id>` (only if spike fails) |
| Wrong page picture changed | L x H | Confirm dialog shows page name + preview; path bound to pageId |

## Security Considerations
- Path prefix check prevents applying another user's object; owner + MANAGE check server-side; token never returned.

## Next Steps
- Post-launch: monitor `failed` rates, 368 blocks, deferred-push failures.
