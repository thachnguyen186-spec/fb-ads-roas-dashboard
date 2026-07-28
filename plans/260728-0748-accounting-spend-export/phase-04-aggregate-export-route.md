# Phase 04 — Aggregate `/api/accounting-export` Route

## Context Links
- FB fan-out + `resolveDateParam` template: `app/api/campaigns/route.ts`
- TikTok bounded-concurrency template: `app/api/tiktok/campaigns/route.ts` (`CONCURRENCY = 3`)
- FB fetchers (Phase 02): `lib/facebook/campaigns.ts` (`fetchCampaigns` w/ `includeAllStatuses`), `campaign-app-map.ts` (`fetchCampaignAppIds`), `campaigns.ts` (`fetchAppNames`), `campaign-destination.ts` (`fetchCampaignDestinations`)
- TikTok fetchers (Phase 03): `lib/tiktok/reporting.ts` (`fetchSpend`), `campaign-target.ts` (`fetchCampaignTargets`), `campaigns.ts` (`fetchCampaigns`)
- Token + scoping: `lib/tiktok/tiktok-connection.ts` (`getValidAccessToken`, `describeAuthError`), `lib/auth-guards.ts` (`getVisibleUserIds`, `getUserRole`)
- Utils: `lib/utils.ts` (`chunk`, `errorResponse`)

## Overview
- **Priority:** P0 (blocker for 06)
- **Status:** completed
- **Description:** New route (admin/leader only) that fans out across the requester's visible FB accounts and (if requested) all TikTok advertisers, resolves spend + target labels, left-joins `account_owners`, and returns `{ rows, warnings, coverage, partial?, leg_aborted? }`. Row-assembly extracted to `lib/accounting/build-rows.ts` to keep the route < 200 lines.

## ⚠️ Pre-Implementation Step (do before writing the route)
**[Red Team Fix #6]** Confirm the Vercel plan tier BEFORE coding. `export const maxDuration = 60;` is a **no-op on Hobby (hard 10s cap)**; it only takes effect on Pro. If Hobby, the parallelization below is not optional hardening — it is the only thing keeping a wide export under 10s, and the 5,000-row ceiling (Fix #15) must be treated as a hard functional limit, not a safety net. Record the tier in the route file header comment.

## Key Insights
- **[Red Team Fix #1]** FIRST line of the handler after auth: `requireRole(user.id, ['admin','leader'])` (reuse `lib/auth-guards.ts`, same pattern as `app/api/admin/users/route.ts`). Staff get 403 here — the tool is admin/leader only.
- **[Red Team Fix #8]** Per-user cooldown: reject a second call within 10s → 429. Keep it cheap — a module-level `Map<userId, lastAt>` (fine for a single-instance function) or a lightweight DB touch if cross-cold-start persistence matters. No rate-limiting subsystem (YAGNI).
- **Reuse `resolveDateParam`** rather than duplicating the allowlist — add `export` to it in `app/api/campaigns/route.ts` and import here (DRY). This is the ONLY change this phase makes to that file.
- FB spend is native-currency already; TikTok spend is native-currency already. **No FX conversion anywhere.**
- **[Red Team Fix #6]** Run the FB leg and TikTok leg as two CONCURRENT top-level promises (`Promise.all([fbLeg(), tiktokLeg()])`), not sequential blocks — roughly halves worst-case wall time for `platform=both`.
- **[Red Team Fix #6]** Within an FB account job, minimize the serial chain: `Promise.all([fetchCampaigns(...), fetchCampaignAppIds(...)])` first; run `fetchCampaignDestinations` only for campaigns still lacking an app_id after that (cuts unnecessary calls); `fetchAppNames` has nothing blocking it. Do NOT chain all four serially.
- **FB leg:** flatten `(token, account)` across ALL visible users × ALL their `fb_ad_accounts` (ignore `is_selected`) into one job list, then process in bounded batches (`CONCURRENCY = 3`) — an admin-wide export can be many users × accounts, so never unbounded `Promise.all`.
- **TikTok leg:** `getValidAccessToken()` ONCE, reused for every advertiser; batch advertisers `CONCURRENCY = 3` (mirror the TikTok dashboard route exactly).
- **Partial-failure resilience:** wrap each account/advertiser job in try/catch; on failure push `"<platform> <account_id>: <message>"` to `warnings[]` and continue. One expired FB token must not 500 the report.
- **[Red Team Fix #12]** Distinguish systemic failure from independent ones: if **5 consecutive** jobs in a leg fail, abort that leg early and set `partial: true` + `leg_aborted: 'facebook'|'tiktok'` — do not keep accumulating individual warnings for what is one root cause (e.g. FB rate-limit trip).
- **[Red Team Fix #5b]** Return a `coverage` field for admin: `{ role, visibleUserCount, totalOrgUserCount }` so partial visibility is visible, not silent. Leader coverage is definitionally complete ("your team") → no `totalOrgUserCount` needed. `getVisibleUserIds` already throws on `listUsers` error (Fix #5a, Phase 01), so a scoping failure surfaces instead of silently shrinking.
- **[Red Team Fix #15]** Hard-cap the aggregate at **5,000 rows**: if exceeded, truncate and push a `warnings[]` entry ("Result truncated at 5,000 rows — narrow your date range or filters"). No pagination/virtualization in v1 (scope creep).
- **[Red Team Fix #4]** TikTok rows built from the UNION of `spendMap` keys and the campaign list (see Phase 03 verification) — a campaign with Reporting spend but absent from `/campaign/get/` still appears, using its raw `campaign_id` as the display name.
- **Target resolution (FB):** app_id present → app name (via `fetchAppNames`), falling back to app_id; else → domain from `fetchCampaignDestinations`; else → `unknown`/'Unknown'.
- **`maxDuration`:** add `export const maxDuration = 60;` — mitigation for the wide fan-out (effective on Pro only — see Pre-Implementation Step).
- `platform` query param: `facebook` | `tiktok` | `both` (default `both`) — skip the unrequested leg entirely.

## Requirements
- `GET /api/accounting-export?since=&until=&datePreset=&platform=`.
- 401 if unauthenticated; **[Fix #1]** 403 if not admin/leader; **[Fix #8]** 429 if called again within 10s.
- Role via `getUserRole`; visible users via `getVisibleUserIds`.
- Returns `{ rows: AccountingExportRow[], warnings: string[], coverage, partial?, leg_aborted? }`.
- `account_owners` left-joined by `(account_id, platform)` → `owner_label` ('' if none).
- Bounded concurrency both legs; legs run concurrently; per-job try/catch → `warnings`; 5-consecutive-failure abort; 5,000-row ceiling.

## Architecture
```
GET /api/accounting-export
  auth.getUser() → 401 else
  requireRole(user.id, ['admin','leader']) → 403 else            [Fix #1]
  cooldown check (Map<userId,lastAt>, <10s) → 429 else            [Fix #8]
  role = getUserRole(user.id) ?? 'staff'
  dateParam = resolveDateParam(searchParams)                      (imported from campaigns route)
  platform ∈ {facebook, tiktok, both}
  ownerMap = load account_owners → Map<`${platform}:${account_id}`, owner_label>

  [Fix #6] both legs run concurrently:  Promise.all([ fbLeg(), tiktokLeg() ])

  fbLeg (if facebook|both):
    visibleIds = getVisibleUserIds(user.id, role)   [throws on listUsers error — Fix #5a]
    load profiles(fb_access_token) + fb_ad_accounts(account_id,name,currency) for visibleIds  (ALL, no is_selected)
    jobs = flatten (token, account)  → batches of 3, tracking consecutiveFailures:
       try  [campaigns, appIds] = await Promise.all([                       [Fix #6 — parallel]
               fetchCampaigns(token, id, name, ccy, dateParam, includeAllStatuses:true),
               fetchCampaignAppIds(token, id)])
            appless = campaigns w/o app_id
            domains = appless.length ? fetchCampaignDestinations(token, id) : empty   [Fix #6 — skip if none]
            names   = fetchAppNames(token, [...appIds.values()])
            buildFbRows(...) → rows ; consecutiveFailures = 0
       catch push warning; if (++consecutiveFailures >= 5) → partial=true, leg_aborted='facebook', STOP   [Fix #12]

  tiktokLeg (if tiktok|both):
    token = getValidAccessToken()  (ONCE)
    advertisers = all tiktok_advertiser_accounts  → batches of 3, tracking consecutiveFailures:
       try  campaigns = fetchCampaigns(token, adv, name, ccy)
            spendMap  = fetchSpend(token, adv, 'CAMPAIGN', {since,until})   ← range from dateParam
            targets   = fetchCampaignTargets(token, adv)
            buildTiktokRows(campaigns, spendMap, targets, ownerMap) → rows  [Fix #4 — UNION of campaigns+spendMap keys]
       catch push warning; if (++consecutiveFailures >= 5) → partial=true, leg_aborted='tiktok', STOP   [Fix #12]

  if (rows.length > 5000) rows = rows.slice(0,5000); warnings.push('truncated at 5,000 rows')   [Fix #15]
  coverage = role==='admin' ? {role, visibleUserCount, totalOrgUserCount} : {role}                [Fix #5b]
  → Response.json({ rows, warnings, coverage, partial, leg_aborted })
```

**dateParam → TikTok range:** `resolveDateParam` may return a `{ preset }`. TikTok needs concrete dates. Resolve the preset to `{ since, until }` for TikTok using a small `presetToRange(preset)` helper in `build-rows.ts`. FB accepts the `InsightDateParam` as-is.

**[Red Team Fix #10] `'maximum'` preset:** FB supports open-ended "since inception"; TikTok's Reporting API does NOT. `presetToRange('maximum')` must return a concrete bounded range for TikTok — **decision (user-confirmed): cap at 1 year back from today** (`{ since: today-1y, until: today }`) with a code comment, and push a `warnings[]` note on the TikTok leg ("TikTok 'maximum' capped at 1 year"). FB still gets true `{ preset: 'maximum' }`. (Chosen over reading `tiktok_connection.connected_at` — simpler, no extra query.)

## Related Code Files
**Create:**
- `app/api/accounting-export/route.ts`
- `lib/accounting/build-rows.ts` (row assembly + `presetToRange` — keeps the route thin)

**Modify:**
- `app/api/campaigns/route.ts` (add `export` keyword to `resolveDateParam` — no behavior change)

## Implementation Steps

0. **[Fix #6]** Confirm the Vercel tier (Hobby 10s / Pro 60s) before writing the route; record it in the route file header. This governs whether `maxDuration=60` and the row ceiling are safety nets or hard limits.

1. In `app/api/campaigns/route.ts`, change `function resolveDateParam` → `export function resolveDateParam`. Nothing else.

2. Create `lib/accounting/build-rows.ts`:
   - `buildFbRows(campaigns, appIdMap, appNameMap, domainMap, ownerMap): AccountingExportRow[]` — per campaign: `app_id` from `appIdMap` (falls back to `campaign.app_id`); if app_id → `target_type:'app'`, label = appName ?? app_id; else domain from `domainMap` → `website`; else `unknown`/'Unknown'. `owner_label` from `ownerMap.get('facebook:'+account_id) ?? ''`.
   - **[Fix #4]** `buildTiktokRows(campaigns, spendMap, targetMap, ownerMap): AccountingExportRow[]` — iterate the **UNION** of `campaigns` (by campaign_id) and `spendMap` keys, not `campaigns` alone. For a spend-only key with no campaign metadata, emit a row using the raw `campaign_id` as `campaign_name`. Spend overlaid from `spendMap`; target from `targetMap`; owner from `ownerMap.get('tiktok:'+account_id) ?? ''`.
   - **[Fix #10]** `presetToRange(preset: string): { since, until }` — allowlisted presets → concrete UTC dates; `'maximum'` → `{ today-1y, today }` (see Architecture note; caller adds the cap warning).
   - Keep each function small; file < 200 lines.

3. Create `app/api/accounting-export/route.ts`:
   ```typescript
   // Vercel tier: <confirmed in step 0>. maxDuration effective on Pro only.
   export const maxDuration = 60;   // wide fan-out + creative/adgroup lookups
   const CONCURRENCY = 3;
   const COOLDOWN_MS = 10_000;      // [Fix #8] per-user
   const MAX_CONSECUTIVE_FAILS = 5; // [Fix #12]
   const ROW_CEILING = 5000;        // [Fix #15]
   const lastExportAt = new Map<string, number>();  // [Fix #8] module-level per-user cooldown
   ```
   - `auth.getUser()` → 401.
   - **[Fix #1]** `const denied = await requireRole(user.id, ['admin','leader']); if (denied) return denied;`
   - **[Fix #8]** cooldown: if `Date.now() - (lastExportAt.get(user.id) ?? 0) < COOLDOWN_MS` → `errorResponse('Please wait a few seconds before exporting again', 429)`; else set `lastExportAt.set(user.id, Date.now())`.
   - `role = (await getUserRole(user.id)) ?? 'staff'`.
   - `dateParam = resolveDateParam(searchParams)`; `if (dateParam instanceof Response) return dateParam;`.
   - `platform = searchParams.get('platform') ?? 'both'`.
   - Load `account_owners` once → `ownerMap`.
   - **[Fix #6]** `const [fbRows, ttRows] = await Promise.all([fbLeg(), tiktokLeg()])` — each leg batched at `CONCURRENCY`, per-job try/catch → `warnings`, `MAX_CONSECUTIVE_FAILS` abort → `partial`/`leg_aborted`.
   - **[Fix #15]** merge rows; if `> ROW_CEILING`, slice + push truncation warning.
   - **[Fix #5b]** build `coverage` (admin: include `totalOrgUserCount`).
   - Return `Response.json({ rows, warnings, coverage, partial, leg_aborted })`.

4. Manual smoke (per role): staff → 403; leader sees own+team FB; admin sees all + coverage note; TikTok present for admin/leader; a deliberately broken FB token yields a warning, not a 500; 5 forced consecutive failures abort the leg with `leg_aborted`; a second rapid call → 429; both platforms return native-currency spend across a past range.

## Todo List
- [x] **[Fix #6]** Confirm Vercel tier; record in route header
- [x] `export` `resolveDateParam` in `app/api/campaigns/route.ts`
- [x] Create `lib/accounting/build-rows.ts` (buildFbRows, buildTiktokRows **[Fix #4 union]**, presetToRange **[Fix #10 maximum]**)
- [x] Create `app/api/accounting-export/route.ts` with `maxDuration=60` + `CONCURRENCY=3`
- [x] **[Fix #1]** `requireRole(['admin','leader'])` first; **[Fix #8]** per-user 10s cooldown → 429
- [x] **[Fix #6]** both legs via `Promise.all`; FB per-account `Promise.all([campaigns, appIds])` + conditional destinations
- [x] **[Fix #12]** 5-consecutive-failure leg abort → `partial`/`leg_aborted`; **[Fix #15]** 5,000-row ceiling
- [x] **[Fix #5b]** `coverage` field (admin includes totalOrgUserCount)
- [x] `npx tsc --noEmit` passes
- [x] Smoke per role (staff 403 / leader / admin); broken-token → warning not 500; cascade → leg_aborted; rapid call → 429

## Success Criteria
- Rows returned for both platforms across a past range, native currency, correct target labels.
- **[Fix #1]** staff → 403; leader/admin visibility scoping correct.
- One failing account → `warnings[]` entry, other accounts still present, HTTP 200.
- **[Fix #12]** ≥5 consecutive failures in a leg → `partial:true` + `leg_aborted`, distinct from routine warnings.
- **[Fix #5b]** admin response carries `coverage`; a `listUsers` error surfaces (not silent self-scoping).
- **[Fix #4]** TikTok spend-only (archived) campaigns appear via the union.
- **[Fix #8]** second call within 10s → 429. **[Fix #15]** >5,000 rows truncated + warned.
- Route file < 200 lines (assembly lives in `build-rows.ts`).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Function timeout on wide admin export | Med | High | **[Fix #6]** concurrent legs + minimized serial chain; `maxDuration=60` (Pro only — confirm tier, step 0); `CONCURRENCY=3`; **[Fix #15]** 5,000-row ceiling |
| Unbounded `Promise.all` across many users×accounts | Med | High | Explicit batched loop (like TikTok route), never full fan-out |
| **[Fix #10]** `'maximum'` preset unresolvable for TikTok | Med | Med | `presetToRange('maximum')` caps at 2y back + warning; FB keeps true maximum |
| **[Fix #8]** Endpoint hammered in a loop → FB app-level (org-wide) rate limit degrades live dashboard | Med | High | Per-user 10s cooldown → 429 |
| **[Fix #12]** Systemic rate-limit cascade masked as many independent warnings | Med | High | 5-consecutive-failure leg abort → `partial`/`leg_aborted`; UI shows distinct red banner |
| **[Fix #5]** admin scoping silently shrinks to self on `listUsers` error | Med | High | `getVisibleUserIds` throws (Phase 01); route surfaces `coverage` |
| `getValidAccessToken` fails but FB leg is fine | Med | Med | TikTok token failure → warnings + skip TikTok leg; FB rows still returned (legs are independent promises) |
| Duplicate campaign_id across accounts collides in a shared map | Low | Med | Keep target/app maps **per-account**, never merge across accounts into one map |

## Security Considerations
- **[Fix #1]** `requireRole(['admin','leader'])` is the first gate after auth — staff (and unauthenticated) never reach the fan-out.
- FB tokens loaded server-side per visible user; never returned to the client.
- Visibility strictly bounded by `getVisibleUserIds` — a leader cannot pull another team's FB spend.
- TikTok read bounded by the admin/leader gate (no longer "any authenticated user").
- `warnings[]` must contain account_id + sanitized message only — never a token (FB/TikTok error messages don't embed tokens; confirm in smoke test).

## Next Steps
- Phase 06 consumes `{ rows, warnings }`.
- Phase 05 (owner routes) is independent and can land in parallel.
