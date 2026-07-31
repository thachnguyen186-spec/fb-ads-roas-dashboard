# Phase 06 — UI: Per-Topic Review/Edit, Batch Review, Bulk Publish, Tool Hub Wiring

## Context Links
- Tool Hub array + the slot to replace: `app/tools/page.tsx:20-57` (**`ads-creative-testing` placeholder at 48-56**), card renderer 96-161
- Hub/leaf component convention: `app/accounting-export/components/accounting-export-hub.tsx`
- Routes consumed: Phase 03 `topics/{id}/publish`, Phase 05 `topics/{id}` PATCH
- Budget/currency rule: `lib/facebook/campaign-actions.ts:145`

## Overview
- **Priority:** P1
- **Status:** pending · **Effort:** 6h
- **Description:** The review-before-anything-real screens and the publish loop. This is the last gate before money moves, so it carries the spend summary, the ACTIVE/PAUSED decision and per-topic result reporting.

## Key Insights
- **Nothing has touched Facebook before this screen.** Everything shown is DB draft state — that is the whole point of the locked-in "draft in our DB, then create live on publish" decision.
- **[Validation Session 1] Publish is a two-level client-driven loop.** Outer loop: sequential over topics (mirrors Phase 05's generation driver). Inner loop, per topic: Phase 03's publish route is now a **step machine** — each call advances one step (campaign, adset, or one creative) — so the UI calls `POST topics/{id}/publish` repeatedly (`await` in a `while (!result.done)` loop) until that topic reports `done:true`, then moves to the next topic. This replaced the original single-long-request-per-topic design during validation: no Vercel tier ever needs confirming, and closing the tab mid-topic resumes cleanly from the last completed step, not just the last completed topic. Still sequential across topics (not concurrent) — Dev-Tier BUC limits start at 300/hr and a 20-topic batch is still ~180 total FB calls (1 campaign + 1 adset + 5×~3 calls per creative) — pacing is load-bearing, not cosmetic.
- **Default PAUSED.** The batch has one `publish_active` toggle, default off, with a confirmation dialog when turned on that restates the total daily spend. Rationale: creatives are machine-generated; going live unattended across 20 campaigns is the expensive spend-risk failure mode. *Recommendation — confirm during validation.*
- **[Red Team Fix] PAUSED protects against spend risk only, NOT review/compliance risk.** Per the plan's own research, Meta's automated ad review begins the moment `/adcreatives`+`/ads` succeed — `status=PAUSED` does not delay or avoid it (`"New ads always enter PENDING_REVIEW post-creation irrespective of the status field"`). A miscategorized or policy-violating creative gets evaluated by Meta regardless of PAUSED/ACTIVE. Do not present PAUSED as mitigating the `special_ad_category`/health-content risk below — it only bounds what happens if a bad ad *clears* review.
- **Total daily spend is shown before the button**, per currency (never summed across currencies — same rule as `plans/260728-0748-accounting-spend-export`). 20 topics × $10 = $200/day is easy to under-appreciate one topic at a time.
- **Partial failure is a first-class outcome, not an error toast.** Per topic the result is `published` (all ads created), `partial_failed` (campaign auto-PAUSED, some ads missing) or `failed` (nothing created / campaign paused). The results panel names the campaign id so the user can open Ads Manager.
- Topics with zero succeeded creatives cannot be published (button disabled with a reason); topics with 1-4 publish with a visible "only N of 5 images" warning.

## Requirements
- Per-topic editable review: 5 images, on-image headlines (read-only, baked in), ad copy + headline, countries, account/Page/Pixel, budget, special-ad-category, target URL.
- Regenerate = whole topic (explicit non-goal: single-image regeneration).
- Final review: all topics collapsed, spend summary, blockers list, publish.
- Per-topic publish status + campaign links; resumable.
- Replace the `ads-creative-testing` Tool Hub entry.

## Architecture

```
afs-hub.tsx (step 'review')
  └─ topic-review-card.tsx × N   (edit → debounced PATCH topics/{id}; "Regenerate topic" → POST generate,
                                  disabled with a tooltip once fb_campaign_id is set — Phase 04's atomic
                                  guard is the server-side enforcement, this is just the matching UI state)
  └─ review-publish-step.tsx
       blockers (hard, publish disabled): topic missing ad_account_id | page_id | countries
                 | ≥1 succeeded creative | budget ≤ 0
       blockers (hard, [Red Team Fix]): employment/housing/credit-ish keywords detected AND
                 special_ad_category=NONE → publish disabled until the user EITHER selects the matching
                 category OR types a literal confirmation phrase acknowledging the override (not a
                 dismissible toast — keyword matching isn't authoritative, but for a High×High risk with
                 account-wide blast radius, "warn and let a busy reviewer click past it" isn't enough)
       spend summary: Σ daily_budget per currency  → "$X/day across N campaigns"
       [ ] Publish as ACTIVE (default off) → confirm dialog restating spend (spend-risk mitigation only —
           does not reduce review/compliance risk, see Key Insights)
       Publish → for topic of publishable:
                 while (!done): await POST topics/{id}/publish → { done, step, result }
                                 (update the topic's live progress indicator per step)
                 → render result row (published | partial_failed | failed + error + campaign id)
                 → on 429/rate-limit error: stop the OUTER loop, keep remaining topics 'ready'/'publishing',
                   show resume (a topic already mid-inner-loop is safely resumable — it just continues
                   from its last completed step next time)
```

## Related Code Files
**Create:** `app/afs-niche-testing/components/topic-review-card.tsx`, `.../review-publish-step.tsx`
**Modify:** `app/afs-niche-testing/components/afs-hub.tsx` (wire the review step — sequential after Phase 05, never in parallel), `app/tools/page.tsx` (replace the placeholder TOOLS entry)

## Implementation Steps
1. `topic-review-card.tsx` (~190 lines) — collapsible card per topic: 5 image thumbnails (signed URLs, click to enlarge, failed slots shown as a grey "failed" tile with the reason); editable `primary_text` (textarea), `ad_headline`, countries, budget (major-unit input, per Phase 05's conversion contract), account/Page/Pixel selects (reusing `connection-selectors.tsx` from Phase 05 — DRY), `special_ad_category`; 600ms-debounced PATCH with a saved/failed indicator; "Regenerate topic" button disabled (with tooltip) once `topic.fb_campaign_id` is set — matches the server-side guard in Phase 04, this is UI state only, not the enforcement.
2. `review-publish-step.tsx` (~180 lines) — read-only summary list, blockers panel ([Red Team Fix] hard-blocking on category-keyword mismatch, not just a warning), per-currency spend summary, ACTIVE toggle + confirm dialog (copy distinguishes spend-risk vs review-risk per Key Insights), the two-level publish loop (outer: topics, inner: publish steps) with a live per-topic step indicator and result rows, "Resume publish" for any not-fully-done remainder, and a link to the campaign in Ads Manager per published topic.
3. `afs-hub.tsx` — add the `'review'` step, pass topics/creatives/handlers down, refetch `batches/{id}` after publish completes.
4. `app/tools/page.tsx` — replace lines 48-56 with:
   ```ts
   {
     id: 'afs-niche-testing',
     name: 'AFS Niche Testing',
     description: 'Bulk-test content niches for AdSense-for-Search: paste topics, auto-generate 5 image ads each, review everything, then launch real Facebook campaigns. Admin/leader only.',
     href: '/afs-niche-testing',
     image: '',
     status: 'active',
     badge: 'Live',
   },
   ```
5. Typecheck, lint, build.

## Todo List
- [x] `topic-review-card.tsx` with debounced PATCH + regenerate-topic
- [x] `review-publish-step.tsx` with blockers, per-currency spend summary, ACTIVE toggle + confirm (includes hard-blocker for special-ad-category keyword match per code review)
- [x] Two-level publish loop (topics × publish-steps) with per-topic live step indicator, result rows + resume
- [x] Wire review step into `afs-hub.tsx`
- [x] Replace the `ads-creative-testing` TOOLS entry
- [ ] **Launch gate:** publish ONE health-adjacent topic and wait for Meta's review verdict before any multi-topic batch [LAUNCH GATE — BLOCKED: requires external leader account and Meta review completion]
- [ ] Manual: edits persist across reload; regenerate replaces all 5 [BLOCKED: requires live testing]
- [ ] Manual: forced failure → campaign PAUSED in Ads Manager, `partial_failed` shown [BLOCKED: requires live testing]
- [ ] Manual: double-click publish, or close the tab mid-inner-loop and reopen → resumes/rejects correctly, no duplicate campaign [BLOCKED: requires live testing]
- [x] Typecheck + lint + build

## Success Criteria
- Every field shown on the review screen matches what lands in Ads Manager after publish (URL, copy, headline, countries, budget, images).
- Publishing a 3-topic batch creates 3 campaigns / 3 adsets / up to 15 ads, all PAUSED by default.
- Spend summary equals the sum of per-topic daily budgets, split by currency, and matches Ads Manager.
- A topic with 0 succeeded creatives cannot be published (reason visible).
- An induced mid-topic failure leaves that campaign PAUSED and reported as `partial_failed`; sibling topics still publish.
- Closing the tab mid-publish and reopening shows accurate per-topic status and allows resume with no duplicates.
- Tool Hub shows "AFS Niche Testing" as Live; no other card changed.

## Risk Assessment
| Risk | L | I | Mitigation |
|------|---|---|-----------|
| Batch published ACTIVE by accident → real spend | Med | **Critical** | Default PAUSED + confirm dialog restating total daily spend + per-currency summary |
| Double-click / retry creates duplicate campaigns | Med | High | Server-side `fb_campaign_id`-non-null hard-fail (Phase 03) + button disabled while in flight |
| User misreads $10/topic as the batch total | High | Med | Explicit "N campaigns × … = $X/day" line above the button |
| Rate limit mid-batch leaves half published | Med | Med | Outer loop stops on 429, remaining topics stay `ready` or resumably `publishing`, resume button |
| Debounced PATCH races the publish click | Low | High | Publish awaits any in-flight PATCH; server re-reads the topic row (never trusts client state) |
| Meta rejects the creatives at review | Med | High | One-topic canary launch gate (run against a genuinely external leader account, per Phase 03's fix) before scaling; rejection is visible in Ads Manager, not in this tool (tracking is a non-goal) |
| **[Red Team Fix]** Employment/housing/credit niche published as NONE, risking account-level Meta enforcement that would also break the existing dashboard/cron/accounting-export sharing that ad account | Med | High | Hard blocker (not a dismissible warning): publish is disabled on keyword match with category=NONE until the user selects the matching category or types an explicit override confirmation |
| **[Red Team Fix]** "Default PAUSED" is read by users as covering Meta-review/compliance risk, when it only covers spend risk (PENDING_REVIEW fires regardless of status) | Low | Med | Confirm dialog copy explicitly separates the two: spend is gated by PAUSED, but review/policy risk is gated by getting the special-ad-category and copy framing right |
| `afs-hub.tsx` grows past 200 lines | Med | Low | Step components own their own state; hub keeps only step/batch/polling state |

## Security Considerations
- Publish route re-reads the topic from the DB and re-checks ownership + role; nothing from the client body is trusted for FB parameters.
- Ads Manager links are constructed from the returned `fb_campaign_id` only.
- Regenerate deletes and replaces that topic's creative rows (and their storage objects) — scoped to the owning user's paths.

## Next Steps
- Post-merge: `docs/journals/` entry per repo convention; consider a "Meta health-ad policy" research pass (flagged in both research reports as unresearched).
