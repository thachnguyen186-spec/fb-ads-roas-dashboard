# Adjust Report API Research Report

**Date:** 2026-04-15  
**Objective:** Map Adjust Report API endpoints, auth, parameters, and response format for campaign revenue data fetch.

---

## 1. API Endpoints

**Base URL:** `https://automate.adjust.com/reports-service/`

Four endpoints available:

| Endpoint | Format | Use Case |
|----------|--------|----------|
| `csv_report` | CSV | Direct column export (best for your use case) |
| `json_report` | JSON | Structured data with metadata |
| `parquet_report` | Parquet | Large bulk exports (performance optimized) |
| `pivot_report` | JSON | Pre-aggregated totals by dimension |

**Recommendation:** Use `csv_report` for parity with current CSV export flow.

---

## 2. Authentication

**Method:** Bearer token in `Authorization` header.

```
Authorization: Bearer {api_token}
```

**Token Source:** Account Settings → My Profile → API Token (copy from UI).

**Token Management:** Can be reset via Account Settings if compromised. Old token invalidates immediately after reset.

---

## 3. Required Parameters

### Base Required
- `app_token` or `app_token__in` (comma-separated for multiple apps)
- At least 1 metric
- At least 1 dimension

### Date Range
- **Format:** `date_period=YYYY-MM-DD:YYYY-MM-DD` (inclusive:inclusive)
- **For today only:** `date_period=2026-04-15:2026-04-15`
- Alternative: `date_from` / `date_to` (needs verification on CSV endpoint)

### Dimensions (Grouping)
Required dimensions for your CSV replication:

| CSV Column | API Dimension |
|-----------|---------------|
| app | `app` |
| channel | Not in standard dimensions; may need `partner_name` |
| campaign_network | `campaign_network` |
| campaign_id_network | `campaign_id_network` |
| adgroup_network | `adgroup_network` |
| adgroup_id_network | `adgroup_id_network` |

**Caveat:** `adgroup_network` and `adgroup_id_network` are not explicitly confirmed in search results. May need manual testing or Adjust support validation.

### Metrics
- `network_cost` → maps to your `cost`/`spend` column
- `all_revenue` → direct mapping
- `cohort_all_revenue` → direct mapping (if available at campaign level)

**Note:** `all_revenue` and `cohort_all_revenue` are cohort metrics (D0–D120). Verify they're available outside cohort-specific endpoints.

### Additional Parameters
- `ad_spend_mode=network` — retrieves network-integrated spend (if using Adjust SpendWorks)

---

## 4. Response Format

**CSV Endpoint Return:** Plain text CSV with header row.

**JSON Endpoint Return:** JSON object with structure:
```json
{
  "row_params": { /* request echoed */ },
  "result_params": { /* pagination */ },
  "rows": [ /* data rows */ ]
}
```

**Field Mapping (CSV):**
Columns returned match dimension + metric order. Field names in CSV:
- Dimensions as-is: `app`, `campaign_id_network`, etc.
- Metrics as-is: `network_cost`, `all_revenue`, `cohort_all_revenue`

---

## 5. Example Request

```bash
GET 'https://automate.adjust.com/reports-service/csv_report
  ?app_token=abc123def456
  &date_period=2026-04-15:2026-04-15
  &dimensions=app,partner_name,campaign,campaign_id_network,campaign_network,adgroup_network
  &metrics=network_cost,all_revenue,cohort_all_revenue
  &ad_spend_mode=network'
```

**Header:**
```
Authorization: Bearer {api_token}
```

---

## 6. Rate Limits & Restrictions

**Limits:** Not explicitly documented in official sources. Assumed standard REST API limits (typically 100–1000 req/min).

**Known Restrictions:**
- Network ad spend data: 14-day lookback (default)
- Meta/Google: 7-day lookback only
- TikTok: 3-day + D7, D14 prior
- Large exports: Use `parquet_report` instead of `csv_report` for performance

**Gotcha:** Ad spend source affects reported metrics. Confirm `ad_spend_mode=network` aligns with your current CSV source.

---

## 7. Cohort vs. All Revenue

- **`all_revenue`:** Total revenue (in-app + ad revenue) on a specific date, grouped by campaign.
- **`cohort_all_revenue`:** Revenue generated from a cohort (users acquired on Dx) measured on any future day. May not be meaningful for single-day campaign-level queries.

**Risk:** `cohort_all_revenue` may require explicit cohort dimension (`cohort_day`). Verify availability for non-cohort queries.

---

## 8. Key Gotchas

1. **Dimension naming mismatch:** API uses `campaign_id_network`, CSV export may differ. Confirm via test request.
2. **Adgroup dimensions:** `adgroup_network` and `adgroup_id_network` not found in official docs. May not be available or named differently.
3. **Cohort metrics at campaign level:** `cohort_all_revenue` behavior at campaign granularity (not user cohort) is undefined.
4. **Ad spend source:** `ad_spend_mode` parameter critical if using manual/push vs. network APIs. Mismatch = different cost figures.
5. **Channel mapping:** CSV includes `channel`; Adjust uses `partner_name`. Different semantics; verify equivalence.

---

## Unresolved Questions

1. **Are `adgroup_network` and `adgroup_id_network` valid dimensions?** (Not in docs; may require Adjust support confirmation.)
2. **Can `cohort_all_revenue` be queried at campaign granularity without cohort dimension?** (Risk of incorrect/null values.)
3. **What is the exact rate limit for CSV endpoint?** (Not documented; assume standard REST limits.)
4. **Does `channel` in current CSV correspond to `partner_name` in API?** (Semantic difference needs confirmation.)
5. **Is ad spend always from `ad_spend_mode=network`, or do you use push API?** (Affects metric selection.)

---

## Recommendation

**Start with CSV endpoint using:**
- Dimensions: `app`, `partner_name`, `campaign`, `campaign_id_network`, `campaign_network`
- Metrics: `network_cost`, `all_revenue`
- Exclude `cohort_all_revenue` until validated
- Test with 1-day range (`date_period=2026-04-15:2026-04-15`)

**Next step:** Run test request and validate field names + row count vs. UI export. Then contact Adjust support to clarify adgroup and cohort metric availability.

---

## Sources

- [Report Service API Overview](https://dev.adjust.com/en/api/rs-api/)
- [CSV Report Endpoint](https://dev.adjust.com/en/api/rs-api/csv/)
- [JSON Report Endpoint](https://dev.adjust.com/en/api/rs-api/reports/)
- [Report Service API Authentication](https://dev.adjust.com/en/api/rs-api/authentication/)
- [Datascape Metrics Glossary](https://help.adjust.com/en/article/datascape-metrics-glossary)
- [Datascape Dimensions Glossary](https://help.adjust.com/en/article/datascape-dimensions-glossary)
- [Ad Spend API Integrations](https://help.adjust.com/en/article/ad-spend-api-integrations)
- [Ad Revenue Reporting](https://help.adjust.com/en/article/ad-revenue-reporting)
- [Cohort KPIs Explained: Revenue Metrics](https://www.adjust.com/blog/demystifying-cohort-kpis-revenue-and-ltv/)
