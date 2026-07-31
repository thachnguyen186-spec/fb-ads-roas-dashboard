# Phase 05 — UI: Page Shell, Topic Intake, FB Selectors, Generation Progress

## Context Links
- Tool page convention: `app/accounting-export/page.tsx:6-15` (auth → role → redirect → client hub)
- Client hub convention: `app/accounting-export/components/accounting-export-hub.tsx` (169 lines; state + fetch + leaf components)
- Selector/checkbox styling precedent: `app/settings/page.tsx:181-215`
- Routes consumed: Phase 03 `fb-assets`, Phase 04 `batches`, `topics/{id}/generate`, `batches/{id}`

## Overview
- **Priority:** P1
- **Status:** pending · **Effort:** 6h
- **Description:** Steps 1-2 of the wizard: topic intake with batch-level defaults, live FB account/Page/Pixel selectors, and the generation-progress view driven by polling. Plus the topic PATCH route the review step needs.

## Key Insights
- **The client is the orchestrator.** It loops topics calling `generate` with concurrency 2 — this is what keeps every serverless invocation short and gives per-topic progress. It is also the throttle for Kie's 20-req/10s cap.
- **Closing the tab is a supported failure mode**, not a bug: un-started topics stay `draft`, in-flight ones stay `generating`, and reopening the batch shows a "Resume generation" button that re-drives only the unfinished topics. State lives entirely in the DB.
- **Batch-level defaults + per-topic override.** Ad account / Page / Pixel / budget / countries / special-ad-category are picked once for the batch and copied onto each topic row at creation; Phase 06 lets any topic diverge. Avoids 20× the same dropdown work while keeping the per-topic model the DB already supports.
- **Paste-parsing beats a form** for 1-20 rows: one textarea, one line per topic, `description <TAB|comma> url`. Parse client-side into an editable table so mistakes are visible before submit.
- Poll every 3s only while any topic is `generating`; stop when all are `ready`/`failed`. No Supabase Realtime dependency (YAGNI — one endpoint already exists and does reconcile as a side effect).

## Requirements
- `/afs-niche-testing` gated to admin+leader (staff → `redirect('/tools')`).
- Intake: ≤20 topics; `https:` URLs only; non-empty description; duplicate-URL warning (not blocking).
- Selectors populated from the **current user's own** launch token; empty-state links to Settings when no token / no Pages.
- Progress view: per-topic state, per-creative thumbnails as they land, retry-topic, resume-batch.
- `PATCH /api/afs-niche-testing/topics/{id}` for Phase 06's edits.

## Architecture

```
app/afs-niche-testing/page.tsx      (server: auth → getUserRole → redirect staff → <AfsHub/>)
  └─ components/afs-hub.tsx         (client: step state 'intake'|'generating'|'review', batch id,
                                     polling loop, generation driver with concurrency 2)
       ├─ topic-input-step.tsx      (textarea paste → parsed rows table → validation)
       ├─ connection-selectors.tsx  (GET fb-assets?accountId= → account/page/pixel selects,
       │                             countries multi-select, budget + currency label,
       │                             special_ad_category select w/ EMPLOYMENT warning)
       └─ generation-progress-step.tsx (per-topic rows: 5 thumb slots, status chips, retry)

Generation driver (in afs-hub):
  queue = topics.filter(status ∈ {draft, failed})
  while queue: take 2 → POST generate (Promise.allSettled) → next 2
  poll GET batches/{id} every 3s until no topic is 'generating'
```

## Related Code Files
**Create:** `app/afs-niche-testing/page.tsx`, `app/afs-niche-testing/components/afs-hub.tsx`, `.../topic-input-step.tsx`, `.../connection-selectors.tsx`, `.../generation-progress-step.tsx`, `app/api/afs-niche-testing/topics/[topicId]/route.ts`
**Modify:** none (Tool Hub wiring is Phase 06 — the page is reachable by URL until then)

## Implementation Steps
1. `page.tsx` — copy `app/accounting-export/page.tsx:6-15` shape verbatim (auth → `getUserRole` → `if (role !== 'admin' && role !== 'leader') redirect('/tools')` → `<AfsHub userEmail role />`).
2. `topic-input-step.tsx` (~140 lines) — textarea + `parseTopics(text)` splitting on newlines then first tab/comma; renders an editable table (description, URL, remove); inline per-row errors; blocks submit on any invalid row or >20 rows; shows the count.
3. `connection-selectors.tsx` (~160 lines) — on mount `GET /api/afs-niche-testing/fb-assets`; account select drives a second call for that account's pixels; Page select disabled with "Add `pages_show_list` to your launch token in Settings" when `pages` is empty; countries as a searchable checkbox list of common ISO codes + free-text add; budget input labelled with the account currency, **entered in major units (e.g. "10.00" for $10/day) — conversion to minor units happens once, server-side, in the PATCH route below (step 6), never in this component**; `special_ad_category` select defaulting NONE with an inline note that jobs/housing/credit niches must select the matching category.
4. `afs-hub.tsx` (~180 lines) — step state machine, `createBatch()` POST, generation driver (concurrency 2), 3s polling with cleanup on unmount, error banner, "Resume generation" when unfinished topics exist, hands off to Phase 06's review step (imported placeholder in this phase, wired in 06).
5. `generation-progress-step.tsx` (~120 lines) — per-topic row: name, status chip (`draft|generating|ready|failed`), 5 thumbnail slots (skeleton → signed-URL image), error text, "Retry topic" (re-POST generate).
6. `topics/[topicId]/route.ts` — `PATCH`: auth → role → ownership → whitelist of editable fields. **[Red Team Fix] Body carries `daily_budget_major` (a decimal, e.g. `10.00`), not `daily_budget_minor` directly** — the route is the single authoritative place that converts to minor units (reusing the exact VND-aware rule from `campaign-actions.ts:145`: ×100 for sub-unit currencies, ×1 for VND) and writes the result to `daily_budget_minor`. This is the one conversion point referenced by Phase 01/03 — no other layer ever re-converts. Validate: https URL, ISO codes, `0 < daily_budget_major`, **and [Red Team Fix] `daily_budget_minor ≤ AFS_MAX_DAILY_BUDGET_MINOR`** (hard server-side ceiling, env-configured — rejects a fat-fingered value regardless of what the human-facing review screen shows), category enum → reject when `status ∈ {publishing, published}` with 409. `GET` returns one topic + creatives (signed URLs), with `daily_budget_major` derived back from `daily_budget_minor` for display.
7. Typecheck, lint, build.

## Todo List
- [x] `page.tsx` with role gate
- [x] `topic-input-step.tsx` incl. paste-parse + validation
- [x] `connection-selectors.tsx` incl. empty-state links to Settings
- [x] `afs-hub.tsx` driver + polling + resume
- [x] `generation-progress-step.tsx` thumbnails/status/retry
- [x] `topics/[topicId]` PATCH/GET with field whitelist + status guard + major→minor budget conversion (single authoritative point) + `AFS_MAX_DAILY_BUDGET_MINOR` ceiling (all code review fixes integrated)
- [ ] Manual: 3-topic batch end-to-end to `ready` [BLOCKED: requires live testing with credentials]
- [ ] Manual: reload mid-generation → progress restored from DB, resume works [BLOCKED: requires live testing]
- [ ] Manual: staff account → redirected to `/tools` [BLOCKED: requires live testing]
- [x] Typecheck + lint + build

## Success Criteria
- Pasting 3 lines produces 3 parsed rows; a `http://` URL blocks submit with a visible reason.
- Selectors list the signed-in user's own accounts/Pages/Pixels; a user without a launch token sees a Settings link, not a crash.
- Generation shows live per-topic progress and thumbnails appear within ~60s.
- Hard-reloading mid-run restores state from the DB and "Resume generation" finishes the batch.
- A failed topic can be retried alone without touching its siblings.
- Every new component file is under 200 lines.

## Risk Assessment
| Risk | L | I | Mitigation |
|------|---|---|-----------|
| Polling loop leaks after unmount / navigates away | Med | Low | `useEffect` cleanup clears the interval; poll guarded by "any topic generating" |
| Tab closed mid-batch leaves topics stuck `generating` | High | Med | Reconcile-on-poll (Phase 04) finishes them; resume button re-drives the rest |
| 20 topics × 5 signed URLs re-minted every 3s poll | Med | Med | Sign only creatives whose `storage_path` changed since last response; 1h TTL means the client can cache |
| User expects per-topic account/page but only sees batch defaults | Med | Low | Defaults copied onto rows at creation; Phase 06 exposes per-topic override |
| Paste format ambiguity (URLs containing commas) | Med | Low | Split on the FIRST tab/comma only; table is editable before submit |
| Countries list becomes a 200-entry scroll | Low | Low | Show ~25 common codes + free-text add (validated server-side) |
| **[Red Team Fix]** Fat-fingered budget value (extra zero, unit confusion) has no backstop beyond a human glancing at a review screen | Med | High | Server-side `AFS_MAX_DAILY_BUDGET_MINOR` ceiling in the PATCH route, independent of any UI confirm dialog |

## Security Considerations
- Server-side role gate on the page **and** on every route — the client gate is UX only.
- PATCH uses an explicit field whitelist; `status`, `fb_*` ids and `user_id` are never client-writable.
- Signed URLs (1h) instead of a public bucket; no Kie or Storage credentials reach the browser.
- Ownership checked per topic id — role does not grant access to another user's batch.

## Next Steps
- Phase 06 wires the review/publish steps into `afs-hub.tsx` and adds the Tool Hub card.
