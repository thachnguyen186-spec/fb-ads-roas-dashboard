# AppsFlyer revenue pull for FB/TikTok campaign merge — research

Date: 2026-10-10. No live API test (no credentials). Several official support pages 403'd → some points from snippets/secondary sources, marked UNVERIFIED.

## 1. Recommendation (ranked)
1. **Master API v4, per day, `app_id=all`** — campaign ID + revenue KPIs in one call. No date grouping → 1 call per day. Premium plan. Ad revenue KPI name UNVERIFIED.
2. **Pull API aggregate `partners_by_date_report/v5`** — native daily rows, IANA `timezone` (Asia/Bangkok OK). Campaign ID documented only for `category=facebook`. Per app. Fallback/cross-check.
3. **Pull raw `ad_revenue_raw/v5`** — CSV, 200K-row cap, 90-day lookback, self-aggregate. Audit only.
4. **Push API** — real-time postback stream to our server. Not needed (we need pull). Ignore "no endpoints defined".

## 2. Master API v4 (primary)
- `GET https://hq1.appsflyer.com/api/master-agg-data/v4/app/{app_id}` — https://dev.appsflyer.com/hc/reference/master_api_get
- Auth: `Authorization: Bearer <API V2 token>`. Tokens created before 2026-03-10 19:00 UTC revoked → regenerate.
- `app_id`: `all` or IDs. Android = package name; iOS = `id12345678`.
- `from`/`to` yyyy-mm-dd, 1–31 days (LTV/install-date range).
- `groupings` (req): `app_id, pid, af_prt, c, af_adset, af_ad, af_channel, af_siteid, af_keywords, is_primary, af_c_id, af_adset_id, af_ad_id, install_time, attributed_touch_type, geo`. No date grouping.
- `kpis` (req). LTV: `impressions, clicks, installs, cr, sessions, loyal_users, cost, revenue, roi, arpu_ltv, average_ecpi, uninstalls…`; patterns `event_counter_[e]`, `unique_users_[e]`, `sales_in_usd_[e]`, `retention_day_[x]`. Activity: `activity_revenue`, `activity_sales_in_usd_[e]`… (activity + `af_c_id` support UNVERIFIED).
- `currency`: `preferred|USD`. `timezone`: `preferred` ONLY (no Asia/Bangkok param). `format`: CSV default | `json`.
- `c` = campaign NAME; `af_c_id` = campaign ID (join key).
- Errors: 401 token; 403 bad params; 404 Master not in plan; 416 unsupported field/too large. 200K-row cap. Freshness 24–48h. Rate limits undocumented.

```bash
curl -G "https://hq1.appsflyer.com/api/master-agg-data/v4/app/all" \
  -H "Authorization: Bearer $APPSFLYER_API_TOKEN" \
  --data-urlencode "from=2026-10-09" --data-urlencode "to=2026-10-09" \
  --data-urlencode "groupings=app_id,pid,c,af_c_id,af_adset_id" \
  --data-urlencode "kpis=installs,cost,revenue,sales_in_usd_af_ad_revenue,event_counter_af_ad_revenue" \
  --data-urlencode "currency=USD" --data-urlencode "timezone=preferred" --data-urlencode "format=json"
```
Response shape UNVERIFIED (no sample in docs) — expect rows keyed by grouping + KPI names.

## 3. Pull API aggregate (fallback)
- `GET https://hq1.appsflyer.com/api/agg-data/export/app/{app-id}/partners_by_date_report/v5` — https://dev.appsflyer.com/hc/reference/get_app-id-partners-by-date-report-v5-1
- Params: `from`,`to`, `media_source`, `category=standard|facebook|organic`, `currency`, `reattr`, `timezone` (IANA; default UTC).
- `category=facebook` adds `campaign_id`, `adset_id`, `adgroup_id`. Non-Meta may show only campaign name. Revenue column names UNVERIFIED. CSV output. Call quotas exist (numbers unverified).

## 4. Ad revenue (IAA)
- `af_ad_revenue` = AppsFlyer-generated event from ROI360 ad revenue (https://support.appsflyer.com/hc/en-us/articles/217490046).
- Whether Master `revenue` includes `af_ad_revenue`: UNVERIFIED → compare `revenue` vs `sales_in_usd_af_ad_revenue` vs dashboard for one day.
- Revenue ETL needs ROI360 Advanced. Aggregate-level S2S ad revenue not in raw reports.
- Day X available X+1 18:00 UTC (= 01:00 ICT X+2) → "today" never available; yesterday after ~01:00 ICT.

## 5. Media source (pid)
- TikTok: `tiktokglobal_int` (legacy `bytedanceglobal_int` deprecated ~2025-09-09; query both during transition).
- Facebook: `facebook_int` likely; verify on a test day.

## 6. Merge mapping
- Key `(date, pid, af_c_id)` ↔ our `campaign_id` (string).
- `af_c_id` only populated if the tracking link/integration passes it — top gotcha. Native Meta via `category=facebook` gives `campaign_id` directly.
- TikTok campaign ID into `af_c_id` via macro — UNVERIFIED; check test data.
- Avoid name (`c`) matching.

## 7. Credentials / env
- `APPSFLYER_API_TOKEN` (API V2, admin creates in dashboard → Security center / API tokens; max 2 per type). Optional `APPSFLYER_APP_IDS` (or `all`).

## 8. Limits / plan
- Master = Premium (404 otherwise). Timezone = app's preferred TZ → check each app set to Asia/Bangkok, else daily buckets mismatch. Currency `USD`.

## Unresolved questions
1. Master `revenue` includes `af_ad_revenue`?
2. Exact IAA KPI name (`sales_in_usd_af_ad_revenue` candidate).
3. Account has Master API (Premium) + ROI360?
4. Ad revenue integration aggregate vs device-level S2S?
5. Each app's preferred timezone?
6. TikTok passes campaign ID into `af_c_id`?
7. Meta pid in this account.
8. Master rate limits for our plan.
9. Master JSON response shape.
10. `app_id=all` vs array form.

## Sources
- https://dev.appsflyer.com/hc/reference/master_api_get
- https://dev.appsflyer.com/hc/reference/get_app-id-partners-by-date-report-v5-1
- https://dev.appsflyer.com/hc/reference/get_app-id-ad-revenue-raw-v5
- https://support.appsflyer.com/hc/en-us/articles/217490046-ROI360-guide-ad-revenue-attribution
- https://support.appsflyer.com/hc/en-us/articles/213223166-Master-API-user-acquisition-metrics-via-API
- https://support.appsflyer.com/hc/en-us/articles/207034356-Push-API-streaming-raw-data
- https://support.appsflyer.com/hc/en-us/articles/7925111265041-Bulletin-TikTok-for-Business-advanced-SRN
- https://support.appsflyer.com/hc/en-us/articles/360004562377-Managing-AppsFlyer-tokens
