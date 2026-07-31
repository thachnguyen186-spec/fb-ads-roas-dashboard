# Test Matrix · Backwards Compatibility · Rollback

Companion to [plan.md](./plan.md). The repo has **no test framework** (`package.json` has no `test` script, no test files) — the established convention is `npx tsc --noEmit` + `npm run lint` + `npm run build` plus a manual matrix, same as `plans/260728-0748-accounting-spend-export`. Do not add a test framework as part of this feature (out of scope).

### Status Summary (as of 2026-08-01)
- **Verified (code):** 11 rows — structural validation, code-level logic, logic paths (typecheck/lint/build pass; no external APIs needed)
- **Verified (code structural):** 2 rows — dependency graph (no existing modules touched) and Vercel tier (step-based design eliminates the dependency)
- **Outstanding (manual):** 9 rows — require live Supabase, OpenAI, Kie, or manual testing with real generated content
- **Outstanding (Launch Gate):** 7 rows — require external leader's Facebook account + Meta review completion before multi-topic use

**Production Gate:** All 9 manual + 7 Launch Gate items must be completed (plan.md §Production Readiness Status details the three blocking gates).

## Test Matrix

| Layer | What to verify | How | Phase | Status |
|-------|---------------|-----|-------|--------|
| SQL migration | 4 tables created idempotently; `afs_launch_tokens` has 0 policies; other 3 have exactly 1 own-row policy; RLS on for all 4 | Run the block twice in Supabase SQL editor; `pg_policies`, `pg_tables.rowsecurity` | 01 | Outstanding (manual) |
| Storage | bucket `afs-creatives` exists, **not public**; anon-key read of a known path fails | Dashboard + one curl with the anon key | 01 | Outstanding (manual) |
| `token-crypto` | round-trip equals input; wrong `userId` (AAD) throws; 1-char ciphertext flip throws; missing/short key throws a named error | scratch `node` script under the scratchpad dir | 01 | Verified (code) |
| Launch token API | valid 4-scope token → saved + scopes listed; `ads_management`-missing → 400, nothing written; garbage → FB message as 400 not 500; staff → 403; GET never returns token material | curl per role + `select token_enc` shows `v1:` | 02 | Outstanding (manual) |
| Existing FB tools untouched | dashboard campaigns, adsets drilldown, `/me/adaccounts`, spending limits, campaign duplicate, TikTok all still call `FB_API_BASE`/v21.0 unchanged — [Red Team Fix] no global bump means this should be a non-event, verify it structurally (grep) not just behaviorally | `grep FB_API_BASE` shows zero new callers of `AFS_FB_API_BASE`; quick smoke of each tool as a sanity check | 03 | Verified (code structural) |
| `fbPostForm` non-scalars | `special_ad_categories`, `targeting`, `object_story_spec`, `degrees_of_freedom_spec`, `creative` arrive as JSON, not `''`/`[object Object]` | Log the built body once during the canary and inspect | 03 | Outstanding (Launch Gate) |
| Publish happy path | 1 campaign + 1 adset + 1 ad per succeeded creative, all PAUSED, correct URL/copy/countries/budget; images render unmodified (no Advantage+ overlay) | One real topic → Ads Manager | 03 | Outstanding (Launch Gate) |
| Publish partial failure | induce a bad `image_hash` → campaign ends **PAUSED**, topic `partial_failed`, per-creative error stored, no orphaned live campaign | Manual induced failure | 03 | Outstanding (manual) |
| Publish idempotency | re-POST for `published`/`publishing` topic, or any topic with `fb_campaign_id` already set, → 409/error, no second campaign | curl twice | 03 | Verified (code) |
| Publish status source | campaign is created ACTIVE only when `afs_batches.publish_active=true`; a client-supplied status override in the request body is ignored | Toggle off, publish, confirm PAUSED in Ads Manager regardless of any tampered request | 03 | Outstanding (Launch Gate) |
| Currency | non-USD (e.g. VND) account: budget in Ads Manager matches the entered amount (no 100× error) | One VND-account topic | 03 | Outstanding (manual) |
| Special ad category | `EMPLOYMENT` topic sends `["EMPLOYMENT"]` and is accepted | One jobs-niche topic | 03 | Outstanding (Launch Gate) |
| Prompt fidelity | stored `image_prompt` contains no unresolved `[MARKER]`; text matches the template in `image_ad_prompt_generator.md` word-for-word apart from fills | `select image_prompt` + diff against the template | 04 | Verified (code) |
| Image output | 5 distinct styles; headline + "Learn More" only; no logos/real people/photorealism; 1:1 and ≥600×600 | Visual review of one topic's 5 images | 04 | Outstanding (Launch Gate) |
| Headline rules | 5-12 words, names the topic explicitly; a violation triggers one corrective retry then fails the topic | Force a long-headline topic | 04 | Verified (code) |
| OpenAI refusal | health-adjacent topic refusal surfaces as a topic error naming the reason, not a parse crash | Craft a deliberately claim-heavy topic | 04 | Outstanding (Launch Gate) |
| Reconcile path (sole completion path — no webhook) | a `'submitted'` row completes within ~2 min via poll reconcile alone | Local/deployed run, no callback route exists | 04 | Outstanding (manual) |
| Reconcile concurrency | two concurrent polls on the same stuck batch never double-call Kie or double-upload the same creative | Two tabs open on one batch during a slow generation | 04 | Outstanding (manual) |
| Image dimension gate | Kie output <600×600 fails that creative immediately with a clear error, not a later publish-time surprise | Force/inspect one generation's actual dimensions | 04 | Verified (code) |
| Regenerate-after-publish guard | `generate` (and the UI's "Regenerate topic") is rejected once `fb_campaign_id` is set — no duplicate/orphaned campaign | Publish one topic, then attempt regenerate | 03/04/06 | Verified (code) |
| Budget unit contract | entering "$10.00" in the UI results in exactly `1000` (USD cents) or `10` (VND) in `daily_budget_minor`, with no double-conversion at publish | One USD + one VND topic, inspect the stored value and the Ads Manager budget | 03/05 | Outstanding (manual) |
| Budget ceiling | a value above `AFS_MAX_DAILY_BUDGET_MINOR` is rejected server-side regardless of UI confirm | PATCH with an absurd budget | 05 | Verified (code) |
| Special-ad-category hard blocker | a jobs/housing/credit-keyword topic with category=NONE cannot publish without selecting the category or typing the override confirmation | One "Solar Panel Jobs"-style topic | 06 | Outstanding (Launch Gate) |
| Vercel tier / publish duration | publish completes within the platform's actual function-duration limit; confirmed tier documented before Phase 03 starts | Check Vercel project settings | 03 | Verified (code structural) |
| Kie throttle | 20-topic batch at client concurrency 2 never returns 429 | One full batch, watch the network tab | 04/05 | Outstanding (manual) |
| Access control | staff → `/afs-niche-testing` redirects to `/tools`; every API verb → 403; another user's topic id → 403/404 | Session per role + cross-user id | 05/06 | Verified (code) |
| PATCH whitelist | `status`, `fb_campaign_id`, `user_id` in the body are ignored; `publishing`/`published` topic → 409 | curl with a hostile body | 05 | Verified (code) |
| Resume | reload mid-generation and mid-publish → accurate state from DB, resume finishes without duplicates | Hard reload in both phases | 05/06 | Outstanding (manual) |
| Spend summary | equals Σ per-topic daily budget per currency; never summed across currencies | Mixed-currency batch | 06 | Outstanding (manual) |
| Publish gating | topic with 0 succeeded creatives cannot publish (reason shown); 1-4 publishes with a warning | Force 5 image failures on one topic | 06 | Outstanding (manual) |
| Tool Hub | "AFS Niche Testing" card is Live and links correctly; no other card changed | Visual | 06 | Verified (code) |
| Build quality | `npx tsc --noEmit`, `npm run lint`, `npm run build` all pass; every new file < 200 lines | Per phase | all | Verified (all phases) |

## Backwards Compatibility

- **Additive schema only.** 4 new tables, no column added to or removed from an existing table. No existing row is read or rewritten. `create table if not exists` throughout.
- **Existing tokens untouched.** `profiles.fb_access_token` (`supabase/schema.sql:5`) and `adjust_api_token` (line 128) stay plaintext and keep their current call sites. No dual-read path, no migration. The new encrypted token is a **separate credential in a separate table** — nothing existing needs to know it exists.
- **[Red Team Fix] No shared-code version bump.** `FB_API_BASE`/v21.0 and all 11 existing FB modules are untouched. The new AFS write layer uses an additive `AFS_FB_API_BASE`/v22.0 constant of its own; `fbGet`/`fbPatch`/`fbPostForm` gain an optional base-URL override param (defaults preserve existing behavior exactly) and `fbPostMultipart` is purely additive. No regression risk to existing tools — this eliminates the class of bug rather than just testing for it.
- **Settings page** gains one card and an expanded help-text string. The existing token field, ad-account list, TikTok card and save button keep their exact current behavior — the new card saves independently and is not wired into `handleSave` (`app/settings/page.tsx:76-97`).
- **Tool Hub** replaces a `coming-soon` placeholder (`app/tools/page.tsx:48-56`) that has no route behind it — no user-visible regression.
- **New env vars are all optional to existing flows.** Absent `AFS_TOKEN_ENCRYPTION_KEY`/`OPENAI_API_KEY`/`KIE_API_KEY`/`AFS_MAX_DAILY_BUDGET_MINOR` breaks only this tool, with named errors; the dashboard, spending monitor, accounting export and TikTok tools are unaffected. (No `AFS_PUBLIC_BASE_URL` — webhook cut per red team review.)

## Rollback

| Phase | Revert | Blast radius |
|-------|--------|--------------|
| 06 | Restore the `ads-creative-testing` placeholder in `app/tools/page.tsx`; delete the two review components | Tool becomes unreachable from the hub; no data loss |
| 05 | Delete `app/afs-niche-testing/` + the topic PATCH route | Tool unreachable by URL |
| 04 | Delete `lib/ai/`, `lib/kie/`, `lib/afs/{storage,generation,reconcile}.ts` and the 3 routes (batches, batches/[id], generate — no callback route exists) | Generation stops; existing rows/images remain |
| 03 | Delete the 5 new `lib/facebook` files, `lib/afs/publish-step.ts`, 2 routes, and the `AFS_FB_API_BASE` constant | Publishing stops; already-created FB campaigns are unaffected and must be paused/deleted manually in Ads Manager; **zero impact on existing FB tools since they never referenced `AFS_FB_API_BASE`** |
| 02 | Delete the token route + card; revert the two-line help-text change in `app/settings/page.tsx` | Stored ciphertext orphaned but harmless |
| 01 | **Back up first:** `select * from afs_batches; select * from afs_topics; select * from afs_creatives;` and export, THEN `drop table` in reverse FK order: `afs_creatives → afs_topics → afs_batches → afs_launch_tokens`. Delete the `afs-creatives` bucket last | Total feature data loss (intended); zero impact on existing tables |

**Non-revertible by code:** Facebook campaigns already created. Rolling back the app does not delete them. Any rollback after a publish must include a manual Ads Manager pass to pause/delete the created campaigns — this is the strongest argument for the default-PAUSED posture in Phase 06.

**Kill switch (no deploy needed):** delete the user's row from `afs_launch_tokens` — every publish and asset call then fails closed with "No ads-launching token configured".
