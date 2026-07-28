# Phase 03 — TikTok Fetch Fixes: Date-Ranged Reporting + Target Resolver

## Context Links
- Reporting: `lib/tiktok/reporting.ts` (`fetchTodaySpend`, hardcoded UTC "today")
- Campaigns + resilience pattern: `lib/tiktok/campaigns.ts` (`resolveStatus` — `console.warn` fallback, never throws)
- Incident precedent for wrong field names: `docs/journals/20260719-tiktok-phase-4-control-parity-complete.md`
- Date allowlist to reuse: `app/api/campaigns/route.ts` → `resolveDateParam` (Phase 04 exports it)
- TikTok client: `lib/tiktok/tiktok-client.ts` (`tiktokGet`)

## ⚠️ Unconfirmed API Fields — Read First
The `/adgroup/get/` field names below are **best-guess, unverified against a live TikTok response** (web research could not reach official TikTok docs; only SDK references). This is the **same class of risk** as the `operation_status` incident (a wrong field-name guess that silently mis-rendered every row until caught by diagnostic logging — see the journal above).

**Mandated approach (not a blocker):**
- **[Red Team Fix #9]** Send the `fields` param from the FIRST attempt: `fields: JSON.stringify(['campaign_id','app_id','promotion_type','landing_page_url'])`. TikTok list endpoints return only a default field subset without it (same as `fetchAdGroups`/`fetchCampaigns` in this codebase), so these fields would be **always missing** regardless of whether the names are right — and the verify step would misdiagnose that as "wrong names," wasting time. The fields param is not optional.
- Implement against best-guess names: `app_id`, `promotion_type`, `landing_page_url`.
- Apply the **exact `resolveStatus` defensive pattern**: on total miss, `console.warn(..., Object.keys(raw))` and fall back to `'unknown'` — never throw.
- **Verify against a real `/adgroup/get/` response early in this phase** and correct field names if wrong. Because the fields param is present (Fix #9), a "still empty" result means the NAMES are wrong (no missing-fields confound). Routine "verify against live API" step, not a plan blocker.
- **[Red Team Fix #4]** In the SAME verification pass, check whether `/campaign/get/` returns archived/deleted campaigns. If it excludes them, spend-only campaigns (present in Reporting, absent from the campaign list) would be silently dropped from the export — Phase 04's `buildTiktokRows` must build from the UNION of spend-map keys and the campaign list.

## Overview
- **Priority:** P0 (blocker for 04)
- **Status:** completed
- **Description:** (a) Add `fetchSpend(token, advertiserId, dataLevel, dateParam)` to `reporting.ts`, keeping `fetchTodaySpend` as a thin wrapper. (b) New `lib/tiktok/campaign-target.ts` mapping campaign_id → `{ target_type, target_label }` (app_id or website domain), with the defensive logging pattern.

## Key Insights
- TikTok's Reporting API has **no `date_preset` concept** — it takes flat `start_date`/`end_date`. So presets like `last_7d` must be resolved to concrete since/until dates **before** calling `fetchSpend` (done in Phase 04's route, reusing `resolveDateParam`). `fetchSpend` accepts only `{ since, until }`.
- Keep `fetchTodaySpend` as a wrapper calling `fetchSpend(..., { since: today, until: today })` so the existing TikTok dashboard route is untouched.
- TikTok has **no app-name resolution API** anywhere in this codebase → for app-promotion campaigns the `target_label` is the literal `app_id` (honest, not a fake name). Do NOT invent a lookup (YAGNI).
- Website domain (TikTok): extract bare hostname from `landing_page_url` via `new URL().hostname.replace(/^www\./,'')` in try/catch, same as FB.
- `promotion_type` classifies app vs website. Hypothesized values: `'WEBSITE'` vs `'APP_IOS'`/`'APP_ANDROID'` (or similar). Classify defensively: if an `app_id` is present → app; else if a domain resolves → website; else → unknown. This makes the classification robust even if `promotion_type`'s exact values differ from the guess.

## Requirements
- `fetchSpend(token, advertiserId, dataLevel, { since, until }): Promise<Map<id, TiktokSpendMetrics>>`.
- `fetchTodaySpend` unchanged externally (delegates to `fetchSpend`).
- `fetchCampaignTargets(token, advertiserId): Promise<Map<campaign_id, { target_type, target_label }>>` scanning `/adgroup/get/`.

## Architecture
```
fetchSpend(token, adv, level, {since,until})    // generalizes fetchTodaySpend
  loop pages: /report/integrated/get/ { start_date:since, end_date:until, … }
  → Map<id, {spend,impressions,clicks,cpc}>
fetchTodaySpend(token, adv, level) = fetchSpend(token, adv, level, {since:today,until:today})

fetchCampaignTargets(token, adv)                [new; mirrors campaigns.ts pagination]
  loop pages: /adgroup/get/ { advertiser_id }  fields incl. campaign_id, app_id?, promotion_type?, landing_page_url?
  per adgroup, first per campaign_id wins:
    app_id present            → { app,     app_id }
    else domain(landing_page_url) resolves → { website, domain }
    else                      → { unknown, 'Unknown' }  + console.warn(keys)
```

## Related Code Files
**Modify:**
- `lib/tiktok/reporting.ts` (add `fetchSpend`, rewrite `fetchTodaySpend` as wrapper)

**Create:**
- `lib/tiktok/campaign-target.ts`

## Implementation Steps

1. Refactor `lib/tiktok/reporting.ts` — extract the paging loop into `fetchSpend`, add a `since/until` param, keep `fetchTodaySpend` as a wrapper:
   ```typescript
   export interface TiktokDateRange { since: string; until: string }  // YYYY-MM-DD (UTC)

   export async function fetchSpend(
     token: string,
     advertiserId: string,
     dataLevel: TiktokDataLevel,
     range: TiktokDateRange,
   ): Promise<Map<string, TiktokSpendMetrics>> {
     const idField = dataLevel === 'CAMPAIGN' ? 'campaign_id' : 'adgroup_id';
     const map = new Map<string, TiktokSpendMetrics>();
     let page = 1;
     for (;;) {
       const data = await tiktokGet<RawReportResponse>('/report/integrated/get/', {
         advertiser_id: advertiserId,
         start_date: range.since,
         end_date: range.until,
         dimensions: JSON.stringify([idField]),
         metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'cpc']),
         report_type: 'BASIC',
         data_level: DATA_LEVEL_API_VALUE[dataLevel],
         page: String(page),
         page_size: String(PAGE_SIZE),
       }, token);
       // …existing row-mapping loop…
       if (batch.length === 0 || page * PAGE_SIZE >= data.page_info.total_number) break;
       page += 1;
     }
     return map;
   }

   /** Thin wrapper — preserves the existing dashboard route's today-only behavior. */
   export async function fetchTodaySpend(
     token: string, advertiserId: string, dataLevel: TiktokDataLevel,
   ): Promise<Map<string, TiktokSpendMetrics>> {
     const today = new Date().toISOString().slice(0, 10); // UTC — see module note
     return fetchSpend(token, advertiserId, dataLevel, { since: today, until: today });
   }
   ```

2. Create `lib/tiktok/campaign-target.ts` (best-guess fields + `resolveStatus`-style logging):
   ```typescript
   /**
    * campaign_id → { target_type, target_label } by scanning /adgroup/get/.
    * app-promotion → literal app_id (no name lookup exists for TikTok); website → bare domain.
    *
    * ⚠️ Field names (app_id, promotion_type, landing_page_url) are UNCONFIRMED against a live
    * response. Missing fields are logged (keys only, never full row) and fall back to 'unknown'
    * — mirrors resolveStatus() in campaigns.ts so a wrong guess is diagnosable from Vercel logs.
    */
   import { tiktokGet } from './tiktok-client';

   export type TargetType = 'app' | 'website' | 'unknown';
   export interface CampaignTarget { target_type: TargetType; target_label: string }

   interface RawAdGroupTarget {
     campaign_id?: string;
     app_id?: string;
     promotion_type?: string;
     landing_page_url?: string;
   }

   function domainOf(url?: string): string | null {
     if (!url) return null;
     try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
   }

   function classify(raw: RawAdGroupTarget): CampaignTarget {
     if (raw.app_id) return { target_type: 'app', target_label: raw.app_id };
     const domain = domainOf(raw.landing_page_url);
     if (domain) return { target_type: 'website', target_label: domain };
     console.warn('[tiktok] no app_id/landing_page_url for adgroup — keys:', Object.keys(raw));
     return { target_type: 'unknown', target_label: 'Unknown' };
   }

   export async function fetchCampaignTargets(
     token: string,
     advertiserId: string,
   ): Promise<Map<string, CampaignTarget>> {
     const map = new Map<string, CampaignTarget>();
     let page = 1;
     for (;;) {
       const data = await tiktokGet<{ list: RawAdGroupTarget[]; page_info: { total_number: number } }>(
         '/adgroup/get/',
         {
           advertiser_id: advertiserId,
           // [Red Team Fix #9] REQUIRED — without it TikTok returns only default fields and
           // app_id/promotion_type/landing_page_url are always absent.
           fields: JSON.stringify(['campaign_id', 'app_id', 'promotion_type', 'landing_page_url']),
           page: String(page),
           page_size: '100',
         },
         token,
       );
       const batch = data.list ?? [];
       for (const raw of batch) {
         const cid = raw.campaign_id;
         if (!cid || map.has(cid)) continue;
         map.set(cid, classify(raw));
       }
       if (batch.length === 0 || page * 100 >= data.page_info.total_number) break;
       page += 1;
     }
     return map;
   }
   ```

3. **Verify against live API early (single pass):**
   - Log one raw `/adgroup/get/` row (keys only) against a live advertiser; confirm `app_id` / `promotion_type` / `landing_page_url` exist. The `fields` param (Fix #9) is already present, so if they're still missing the NAMES are wrong — correct `RawAdGroupTarget` + `classify`.
   - **[Fix #4]** Check whether `/campaign/get/` returns archived/deleted campaigns (e.g. compare its campaign_ids against the Reporting API's spend-map keys for a past range). Record the finding for Phase 04's `buildTiktokRows` union logic.

4. Manual smoke: past date range returns spend; `fetchTodaySpend` still today-only; app campaign → `app` + app_id; website campaign → `website` + domain.

## Todo List
- [x] Add `fetchSpend` + `TiktokDateRange` to `lib/tiktok/reporting.ts`; make `fetchTodaySpend` a wrapper
- [x] Create `lib/tiktok/campaign-target.ts` with the `fields` param (**[Fix #9]**) + defensive `classify` + `console.warn` fallback
- [ ] **Verify `/adgroup/get/` field names against a live response; correct if wrong**
- [x] **[Fix #4]** Verify whether `/campaign/get/` returns archived/deleted campaigns; record for Phase 04 union
- [x] `npx tsc --noEmit` passes
- [x] Smoke: past-range spend; today wrapper unchanged; app vs website classified

## Success Criteria
- `fetchSpend` honors `since/until`; `fetchTodaySpend` behaves exactly as before (dashboard route untouched).
- `fetchCampaignTargets` classifies app (app_id) vs website (domain) and never throws on unknown fields — it logs and returns `'unknown'`.
- Field-name verification step completed and any corrections applied.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `app_id`/`promotion_type`/`landing_page_url` names wrong | High | Med | Defensive `classify` + `console.warn(keys)`; mandatory live-verification todo; classification keys off presence, not exact enum values |
| `/adgroup/get/` doesn't return these fields without an explicit `fields` param | Med | Med | If empty, add a `fields` param listing them; discovered during the verification step |
| **[Fix #13]** Date-boundary mismatch — TikTok takes flat UTC `since/until` while FB resolves `time_range`/`date_preset` per EACH ad account's own configured reporting timezone | Med | Med | Real caveat, not a dismissal: this codebase has hit the timezone-boundary class before (see `docs/journals/20260717-adjust-revenue-bangkok-timezone.md`). No full per-account-TZ normalization in v1 (FB makes it expensive — over-engineering). Phase 06 renders an explicit caveat next to the date picker. Month-boundary accounting closes are exactly where "multi-day averages it out" fails, so both axes must be acknowledged. |
| Reporting lag (24–48h) understates recent ranges | Med | Low | Exports target closed periods; acceptable |

## Security Considerations
- Org-wide TikTok token via `getValidAccessToken()` (Phase 04), never per-advertiser, never logged.
- `console.warn` logs field **keys only**, never values/tokens (matches `resolveStatus`).

## Next Steps
- Phase 04 imports `fetchSpend` + `fetchCampaignTargets` for the TikTok leg.
