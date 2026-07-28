# Phase 02 — FB Fetch Fixes: `includeAllStatuses` + Website Destination Resolver

## Context Links
- FB campaigns fetcher: `lib/facebook/campaigns.ts` (`fetchCampaigns`, the `filtering` bug at line 155)
- Structural template: `lib/facebook/campaign-app-map.ts` (paginated adsets scan → Map)
- App names: `lib/facebook/campaigns.ts` → `fetchAppNames`
- Proven destination field path: `lib/facebook/campaign-csv-export.ts:219` (`creative.object_story_spec.link_data.link`)

## Overview
- **Priority:** P0 (blocker for 04)
- **Status:** completed
- **Description:** (a) Add an optional `includeAllStatuses` param to FB `fetchCampaigns` so archived/deleted campaigns' historic spend is not silently dropped. (b) New `lib/facebook/campaign-destination.ts` mapping campaign_id → website domain, mirroring `campaign-app-map.ts`.

## Key Insights
- The current `filtering: [{effective_status IN [ACTIVE,PAUSED,CAMPAIGN_PAUSED]}]` is correct for a live dashboard but **wrong for a historical export** — a campaign archived last month still spent money 3 months ago and must appear. When `includeAllStatuses:true`, omit `filtering` entirely; keep the final `.filter(c => c.spend > 0)` (that's what actually scopes the export to spenders).
- Backward compatibility is non-negotiable: new param is a trailing optional defaulting `false`; existing callers unchanged.
- Website domain lives on the **ad creative**, not the campaign. Proven working path: `creative.object_story_spec.link_data.link`. Advantage+/dynamic-creative ads instead use `creative.asset_feed_spec.link_urls[].website_url` — check both.
- Extract **bare hostname**, not the full URL: `new URL(link).hostname.replace(/^www\./,'')`, wrapped in try/catch (skip malformed).
- KISS: always build the whole-account domain map; the caller (Phase 04) only consults it for campaigns that have no `app_id`. Don't try to pre-filter which campaigns to look up.
- **[Red Team Fix #3]** "first ad wins" is UNSAFE here. `campaign-app-map.ts` justifies first-wins with a real FB invariant ("a campaign promotes a single app"); that invariant does NOT hold for landing-page URLs — a campaign can run ads with different destinations (A/B, prospecting vs remarketing), and a $0-spend test ad could win. Mitigation: request each ad's `insights{impressions}` and keep the domain of the **highest-impression ad** per campaign (best cheap proxy for "representative"). This is still a **sample, not ground truth** — the label is "one observed destination," surfaced with a UI tooltip in Phase 06, never presented as authoritative. Do NOT build full spend-weighted resolution (real scope creep).

## Requirements
- `fetchCampaigns(..., dateParam, includeAllStatuses = false)` — omit `filtering` when true.
- New `fetchCampaignDestinations(token, adAccountId): Promise<Map<campaign_id, string>>` returning bare domains, **[Fix #3]** highest-impression ad per campaign wins (not first-seen).
- **[Fix #3]** the resolved domain is documented (here + Phase 06 UI) as "one observed destination, not guaranteed representative of the campaign's full spend."
- Per-account resilience: a destination-scan failure must not throw up the stack (Phase 04 wraps calls, but this module returns an empty Map on total failure like `fetchAppNames` does).

## Architecture
```
fetchCampaigns(token, acct, name, currency, dateParam, includeAllStatuses)
  do { GET /{acct}/campaigns?fields=…&limit=100 [+filtering unless includeAllStatuses] } paginate
  → map → .filter(spend > 0)

fetchCampaignDestinations(token, acct)                       [new, mirrors campaign-app-map.ts]
  do { GET /{acct}/ads?fields=campaign_id,creative{object_story_spec{link_data{link}},
                                                    asset_feed_spec{link_urls}}&limit=500 } paginate
  → for each ad: link = link_data.link ?? asset_feed_spec.link_urls[0].website_url
     domain = hostname(link) (try/catch skip) ; first per campaign_id wins
  → Map<campaign_id, domain>
```

## Related Code Files
**Modify:**
- `lib/facebook/campaigns.ts` (add `includeAllStatuses` param + conditional `filtering`)

**Create:**
- `lib/facebook/campaign-destination.ts`

## Implementation Steps

1. In `lib/facebook/campaigns.ts`, extend the signature and make `filtering` conditional:
   ```typescript
   export async function fetchCampaigns(
     token: string,
     adAccountId: string,
     accountName: string,
     currency: string = 'USD',
     dateParam: InsightDateParam = { preset: 'today' },
     includeAllStatuses: boolean = false,   // NEW — historical export needs archived/deleted
   ): Promise<CampaignRow[]> {
     ...
     const params: Record<string, string> = {
       fields: `${CAMPAIGN_FIELDS},${insightFields}`,
       limit: '100',
     };
     if (!includeAllStatuses) {
       params.filtering = JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED'] }]);
     }
     if (after) params.after = after;
     ...
     return campaigns.filter((c) => c.spend > 0);  // unchanged
   }
   ```

2. Create `lib/facebook/campaign-destination.ts` (mirror `campaign-app-map.ts` pagination):
   ```typescript
   /**
    * Builds campaign_id → website domain by scanning an ad account's ads for the
    * creative's destination link. Standard link ads expose it at
    * object_story_spec.link_data.link; Advantage+/dynamic-creative ads use
    * asset_feed_spec.link_urls[].website_url.
    *
    * [Red Team Fix #3] A campaign can run ads with DIFFERENT destinations, so there is no
    * single true domain. We keep the domain of the highest-impression ad per campaign as the
    * best cheap proxy — this is one OBSERVED destination, NOT authoritative for the campaign's
    * full spend (surfaced with a UI caveat in Phase 06).
    * Best-effort: malformed URLs are skipped, total failure returns an empty Map.
    */
   import { fbGet } from './fb-client';

   interface RawAdRow {
     campaign_id?: string;
     creative?: {
       object_story_spec?: { link_data?: { link?: string } };
       asset_feed_spec?: { link_urls?: { website_url?: string }[] };
     };
     insights?: { data?: { impressions?: string }[] };  // [Fix #3] pick the most-shown ad
   }
   interface RawPage { data: RawAdRow[]; paging?: { cursors?: { after?: string }; next?: string } }

   function toDomain(url?: string): string | null {
     if (!url) return null;
     try { return new URL(url).hostname.replace(/^www\./, ''); }
     catch { return null; }
   }

   export async function fetchCampaignDestinations(
     token: string,
     adAccountId: string,
   ): Promise<Map<string, string>> {
     const map = new Map<string, string>();
     const bestImp = new Map<string, number>();  // [Fix #3] impressions of the winning ad per campaign
     let after: string | undefined;
     try {
       do {
         const params: Record<string, string> = {
           fields: 'campaign_id,creative{object_story_spec{link_data{link}},asset_feed_spec{link_urls}},insights{impressions}',
           limit: '500',
         };
         if (after) params.after = after;
         const page = await fbGet(`/${adAccountId}/ads`, params, token) as RawPage;
         for (const ad of page.data ?? []) {
           const cid = ad.campaign_id;
           if (!cid) continue;
           const link = ad.creative?.object_story_spec?.link_data?.link
             ?? ad.creative?.asset_feed_spec?.link_urls?.[0]?.website_url;
           const domain = toDomain(link);
           if (!domain) continue;
           const imp = Number(ad.insights?.data?.[0]?.impressions ?? 0);
           if (!map.has(cid) || imp > (bestImp.get(cid) ?? -1)) {
             map.set(cid, domain);
             bestImp.set(cid, imp);
           }
         }
         after = page.paging?.cursors?.after;
         if (!page.paging?.next) break;
       } while (after);
     } catch {
       // Best-effort: destination enrichment is non-fatal (matches fetchAppNames)
     }
     return map;
   }
   ```

3. Manual smoke test:
   - Website-objective account over a past range → `includeAllStatuses:true` returns archived campaigns; each app-less campaign gets a bare domain.
   - App-promotion account → domains empty for app campaigns (expected; Phase 04 uses app name instead).
   - Confirm dashboard load (`/api/campaigns` with default args) still returns identical results.

## Todo List
- [x] Add `includeAllStatuses` param + conditional `filtering` in `lib/facebook/campaigns.ts`
- [x] Create `lib/facebook/campaign-destination.ts`
- [x] `npx tsc --noEmit` passes
- [x] Smoke: archived campaign appears with `includeAllStatuses:true`
- [x] Smoke: bare domain resolved for an app-less campaign
- [x] Regression: default dashboard `/api/campaigns` unchanged

## Success Criteria
- Existing callers compile and behave identically (default `false`).
- `includeAllStatuses:true` includes archived/deleted campaigns that spent > 0 in range.
- `fetchCampaignDestinations` returns bare domains (no `www.`, no path), skips malformed URLs, never throws.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `/{acct}/ads` scan is heavy on large accounts (limit 500, paginated) | Med | Med | One call per account, minimal fields; Phase 04 runs it under bounded concurrency + `maxDuration=60` |
| Creative shape varies (video-only, catalog ads) → no link | Med | Low | Optional-chained; missing link → campaign simply has no domain, falls back to 'unknown' in Phase 04 |
| **[Fix #3]** Resolved domain not representative of full campaign spend (mixed-destination campaign) | Med | Med | Keep highest-impression ad's domain; label documented as "one observed destination"; Phase 06 shows a tooltip on the Target column — never presented as ground truth |
| FB field-spec nesting rejected by API | Low | Med | Path proven at `campaign-csv-export.ts:219`; verify in smoke test |
| Removing `filtering` changes result ordering | Low | Low | Order irrelevant — rows sorted client-side in Phase 06 |

## Security Considerations
- Token only flows through `fbGet`; never logged.
- No new PII; domains are public destinations.

## Next Steps
- Phase 04 imports both the extended `fetchCampaigns` and `fetchCampaignDestinations`.
