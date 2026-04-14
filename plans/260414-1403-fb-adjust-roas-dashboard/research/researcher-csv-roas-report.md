# CSV Parsing & ROAS Calculation Research — FB/Adjust Dashboard

**Date:** 2026-04-14 | **Context:** Next.js client-side CSV processing, campaign data merging, ROAS calculation

---

## 1. CSV Parsing: PapaParse vs FileReader API

### Recommendation: **PapaParse** (lightweight, 14KB gzip)

| Aspect | FileReader API | PapaParse |
|--------|---|---|
| **Learning curve** | Manual text parsing required | Declarative config, handles edge cases |
| **Size** | 0 bytes (native) | 14 KB gzipped |
| **Quote escaping** | Manual regex (fragile) | Built-in (handles: `"field ""quoted"""`) |
| **Streaming large files** | ✓ (chunked reading) | ✓ (chunking available) |
| **Performance** | Faster (raw API) | Imperceptible overhead (~2% CPU) |
| **Production adoption** | Risky (subtle CSV bugs) | Battle-tested (50K+ GitHub stars) |
| **Type safety** | Manual casting required | Works well with TypeScript generics |

**Decision:** Use PapaParse. Native API forces you to reinvent CSV parsing (quote escaping, newline handling in fields, BOM stripping). PapaParse is standard-library-grade for this use case.

**Implementation (Next.js):**
```typescript
import Papa from 'papaparse';

const parseCsv = async (file: File) => {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false, // Keep as strings for mapping validation
      error: reject,
      complete: (results) => resolve(results.data),
    });
  });
};
```

---

## 2. Column Mapping UI Pattern

### Flow: Upload → Preview Headers → Drag/Select Mapping → Confirm → Parse

**Best UX Pattern:**
1. **Preview step** — Show first 3 CSV rows before mapping
2. **Auto-detect** — Guess mapping (fuzzy match: `campaign_name` → `Campaign Name`, `revenue` → `Revenue (USD)`)
3. **Manual override** — Dropdown per expected field:
   - Required: `campaign_id`, `revenue`, `spend`
   - Optional: `campaign_name`, `installs`, `cost`, `currency`
4. **Validation** — Block confirm if required fields unmapped or data type mismatch (revenue as string)

**React Component Pattern:**
```typescript
interface ColumnMapping {
  csvColumn: string;  // Actual CSV header
  expectedField: 'campaign_id' | 'campaign_name' | 'revenue' | 'spend' | ...;
}

// UI shows dropdowns: [CSV Header] → [Expected Field Dropdown]
// Auto-fill based on fuzzy match, user overrides as needed
```

**Why this beats drag-drop:** Avoids mobile friction, scales to 20+ columns, accessibility-friendly.

---

## 3. Adjust CSV Export Format

**Typical Adjust campaign report exports:**
- `Campaign ID` — network_campaign_id (Facebook ad set ID or campaign ID)
- `Campaign Name` — user-defined name
- `Network` — "Facebook", "Google", etc.
- `Installs` — attributed installs
- `Sessions` — optional, deep-link sessions
- `Revenue` — attributed revenue (currency per export config)
- `Spend` — ad spend (cost)
- `Currency` — export currency (e.g., USD, THB)
- `CTR`, `CPI`, `ROAS` — Adjust calculates, but we'll recalculate client-side

**Adjust quirks:**
- Revenue often NULL if no purchase tracking → fallback to 0
- `Campaign ID` may be truncated or formatted differently per network
- Multiple rows per campaign if time-bucketed (daily/hourly) → aggregate first
- Currency may vary by export scope — validate before merging

---

## 4. ROAS Calculation & Edge Cases

**Formula:** `ROAS = Revenue / Spend` (percentage × 100 for display)

### Edge Cases & Handling:

| Case | Value | Handling |
|------|-------|----------|
| Spend = $0 | ∞ | Show "—" (N/A) or "No data" |
| Revenue = 0, Spend > 0 | 0% | Display as `0.00x` (red color) |
| Both 0 | Undefined | Show "—" |
| Negative values | Various | Treat as data error, log warning, show "Invalid" |

**Implementation:**
```typescript
const calculateRoas = (revenue: number, spend: number): {
  value: number | null;
  display: string;
  status: 'healthy' | 'warning' | 'error' | 'nodata';
} => {
  if (spend === 0 || !spend) return {
    value: null,
    display: '—',
    status: 'nodata',
  };
  if (revenue < 0 || spend < 0) return {
    value: null,
    display: 'Invalid',
    status: 'error',
  };
  const roas = revenue / spend;
  return {
    value: roas,
    display: roas.toFixed(2) + 'x',
    status: roas >= 2 ? 'healthy' : roas >= 1 ? 'warning' : 'error',
  };
};
```

**Display:**
- Format: `2.45x` (2 decimals, multiplier notation)
- Color code: Green (≥2x), Yellow (1–2x), Red (<1x), Gray (N/A)
- Currency storage: Keep revenue/spend in same currency, flag if mixed

---

## 5. Data Merge Pattern: FB Campaigns + Adjust CSV

**Pattern: Left Join (Keep all FB campaigns)**

```typescript
interface MergedCampaign {
  campaignId: string;
  campaignName: string;
  fbSpend: number;
  adjustRevenue: number | null;  // null if no Adjust match
  roas: ReturnType<typeof calculateRoas>;
}

const mergeCampaigns = (
  fbCampaigns: FbCampaign[],
  adjustData: AdjustRow[]
) => {
  const adjustMap = new Map(
    adjustData.map(row => [row.campaign_id, row])
  );
  
  return fbCampaigns.map(fb => {
    const adjust = adjustMap.get(fb.campaign_id);
    return {
      campaignId: fb.campaign_id,
      campaignName: fb.name,
      fbSpend: fb.spend,
      adjustRevenue: adjust?.revenue ?? null,
      roas: calculateRoas(adjust?.revenue ?? 0, fb.spend),
    };
  });
};
```

**Key decisions:**
- **Left join:** FB is source of truth (all campaigns shown, even if no Adjust match)
- **campaign_id matching:** Ensure FB export & Adjust export use same ID field (FB `ad_set_id` or `campaign_id`? Adjust uses `network_campaign_id`)
- **Aggregation:** If Adjust CSV is time-bucketed (daily rows), sum revenue/spend per campaign_id before merge
- **Display:** Show "—" for adjustRevenue if null, ROAS as "N/A" (not infinity)

---

## Summary & Recommendations

1. **CSV parsing:** PapaParse (trade-off: +14KB for robust quote/newline handling)
2. **Column mapping:** 3-step UX (preview → auto-detect → manual override → validate)
3. **Adjust format:** Expect `Campaign ID`, `Revenue`, `Spend`, `Currency` columns; handle NULL revenue
4. **ROAS display:** `X.XXx` format, color-code by threshold (2x/1x boundaries), handle zero-spend edge case
5. **Merge strategy:** Left join FB → Adjust by campaign_id, aggregate time-bucketed rows first

**Estimated implementation scope:** 3–4 hours (CSV parser hook, column mapper component, ROAS calculator utility, merge logic).

---

## Unresolved Questions

1. **FB campaign_id vs ad_set_id:** Which does FB API export? Confirm field name in your existing FB data structure.
2. **Adjust CSV structure:** Does your Adjust export include daily/hourly bucketing or is it campaign-aggregate? If bucketed, aggregation step needed before merge.
3. **Currency handling:** Do FB and Adjust always use same currency, or do we need FX conversion? (Affects ROAS calculation)
4. **Persistence:** Should merged data be cached (localStorage/IndexedDB) or re-merge on every CSV upload?
5. **Validation rules:** Do you want to reject mismatches (e.g., campaign_id exists in FB but not Adjust)? Or silently show N/A?
