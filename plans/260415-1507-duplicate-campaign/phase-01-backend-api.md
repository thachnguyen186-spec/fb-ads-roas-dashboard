# Phase 1: Backend — FB API Copy + CSV Export Route

## Context Links

- [plan.md](./plan.md)
- Source: `lib/facebook/campaign-actions.ts` (existing pause/budget actions)
- Source: `lib/facebook/fb-client.ts` (fbGet, fbPatch)
- Source: `app/api/campaigns/[campaignId]/route.ts` (PATCH handler)
- FB API ref: `POST /{campaign_id}/copies` (same-account deep copy)
- FB API ref: GET ads/adsets/creatives for CSV generation

## Overview

- **Priority:** P2
- **Status:** Pending
- **Description:** Two backends: (1) same-account duplicate via FB copies API, (2) cross-account CSV export — fetch full structure and generate FB-format CSV.

## Key Insights

1. **Same-account copy** — `POST /{campaign_id}/copies` with `deep_copy=true` copies campaign + ad sets + ads natively. Returns `{ copied_campaign_id }`. Post-copy PATCH sets custom name + budget.
2. **Cross-account: TSV approach** — FB's "Import Ads from Spreadsheet" UI-only feature accepts a tab-delimited file where missing IDs = create new. No API endpoint for import — we generate the TSV, user downloads and uploads manually. FB's own engine handles creative migration (image URLs, assets) internally.
3. **Confirmed file format from actual FB export** — UTF-16 LE encoding with BOM (`\uFFFE`), tab-delimited (NOT comma), 63 columns. Verified from `export_20260415_1545.csv` provided by user.
4. **3 columns to clear** — Set to empty string (not delete the column):
   - `Campaign ID` (col 0) — values like `cg:120242825359210101`
   - `Ad Set ID` (col 12) — values like `c:120242825359230101`
   - `Ad ID` (col 43) — values like `a:120242825359460101`
5. **Campaign Name editable** — `Campaign Name` is col 1. User specifies new name in modal; we set it in the TSV before download.
6. **All other fields preserved verbatim** — targeting, creative hashes, video IDs, budgets, etc. FB's importer re-uses CDN image URLs and video IDs directly.
7. **`fbPost` not needed** — The copies endpoint uses POST but the existing `fbPatch` already uses POST internally. We just need `fbGet` for fetching structure.

## Requirements

### Functional (Same-account)
- FR1: Duplicate 1-10 copies within same account using FB copies API
- FR2: Each copy gets custom name + optional budget override
- FR3: All copies start as PAUSED

### Functional (Cross-account)
- FR4: Fetch full campaign structure: campaign → ad sets → ads → creatives
- FR5: Generate CSV in FB import format with Campaign ID / Ad Set ID / Ad ID cleared
- FR6: Replace campaign name with user-specified name in CSV
- FR7: Return CSV as downloadable file response

### Non-Functional
- NFR1: No new npm dependencies
- NFR2: Sequential API calls for copies (rate-limit safe)
- NFR3: CSV generation must handle campaigns with 0 ads gracefully

## Architecture

### Same-account API contract
```
POST /api/campaigns/[campaignId]
  body: {
    action: 'duplicate',
    source_account_id: string,
    copies: Array<{ name: string; budget_amount?: number; budget_type?: 'daily' | 'lifetime' }>
  }
  response: { results: Array<{ name: string; success: boolean; campaign_id?: string; error?: string }> }
```

### Cross-account CSV export API contract
```
GET /api/campaigns/[campaignId]/export-csv
  query: { newName: string }
  response: CSV file (Content-Disposition: attachment; filename="campaign-export.csv")
```

## Related Code Files

### Create
- `lib/facebook/campaign-csv-export.ts` — fetch full campaign structure + generate CSV content
- `app/api/campaigns/[campaignId]/export-csv/route.ts` — GET handler returning CSV download

### Modify
- `lib/facebook/campaign-actions.ts` — add `duplicateCampaignSameAccount`
- `app/api/campaigns/[campaignId]/route.ts` — add POST handler for `action: 'duplicate'`

## Implementation Steps

### Step 1: Add `duplicateCampaignSameAccount` to campaign-actions.ts

```typescript
export async function duplicateCampaignSameAccount(
  token: string,
  campaignId: string,
  name: string,
  budgetOverride?: { amount: number; type: 'daily' | 'lifetime'; currency: string },
): Promise<string> {
  // POST /{campaignId}/copies — FB natively copies campaign + adsets + ads
  const copyRes = await fbPatch(`/${campaignId}/copies`, {
    deep_copy: 'true',
    status_option: 'PAUSED',
    rename_options: JSON.stringify({ rename_strategy: 'ONLY_TOP_LEVEL_RENAME' }),
  }, token) as { copied_campaign_id: string };

  const newId = copyRes.copied_campaign_id;

  // PATCH the copy with custom name
  await fbPatch(`/${newId}`, { name }, token);

  // PATCH budget override if provided
  if (budgetOverride) {
    const fbValue = budgetOverride.currency === 'VND'
      ? Math.round(budgetOverride.amount)
      : Math.round(budgetOverride.amount * 100);
    const field = budgetOverride.type === 'daily' ? 'daily_budget' : 'lifetime_budget';
    await fbPatch(`/${newId}`, { [field]: String(fbValue) }, token);
  }

  return newId;
}
```

### Step 2: Add POST handler to route.ts

Alongside the existing `PATCH` export, add:

```typescript
export async function POST(request: NextRequest, { params }: Params) {
  // Auth + token fetch (same pattern as PATCH)
  // Parse body: { action: 'duplicate', source_account_id, copies: [...] }
  // Validate: copies.length 1-10, all names non-empty
  // Loop copies sequentially:
  //   result = await duplicateCampaignSameAccount(token, campaignId, copy.name, copy.budget?)
  // Return { results: [...] }
}
```

### Step 3: Create `lib/facebook/campaign-csv-export.ts`

This module fetches the full structure and generates the TSV string matching FB's exact export format.

**File format (verified from actual FB export):**
- Encoding: UTF-16 LE with BOM (`\uFFFE` prepended)
- Delimiter: tab (`\t`), NOT comma
- Line endings: `\r\n`
- 63 columns in exact order (see below)

**63 column names (exact, in order):**
```
Campaign ID | Campaign Name | Campaign Status | Campaign Objective | Buying Type |
Campaign Bid Strategy | Campaign Start Time | New Objective | Buy With Prime Type |
Is Budget Scheduling Enabled For Campaign | Campaign High Demand Periods |
Buy With Integration Partner | Ad Set ID | Ad Set Run Status |
Ad Set Lifetime Impressions | Ad Set Name | Ad Set Time Start | Ad Set Daily Budget |
Destination Type | Ad Set Lifetime Budget | Is Budget Scheduling Enabled For Ad Set |
Ad Set High Demand Periods | Link Object ID | Optimized Event | Link | Application ID |
Object Store URL | Global Regions | Location Types | Excluded Countries |
Age Min | Age Max | Advantage Audience | Age Range | Targeting Optimization |
Beneficiary | Payer | User Device | User Operating System |
Brand Safety Inventory Filtering Levels | Optimization Goal | Attribution Spec |
Billing Event | Ad ID | Ad Status | Preview Link | Instagram Preview Link |
Ad Name | Title | Body | Optimize text per person | Optimized Ad Creative |
Image Hash | Image File Name | Creative Type | Video ID | Video File Name |
Instagram Account ID | Call to Action | Additional Custom Tracking Specs |
Video Retargeting | Permalink | Use Page as Actor
```

**3 columns to clear (set to empty string):**
- Col 0: `Campaign ID` (original value format: `cg:120242825359210101`)
- Col 12: `Ad Set ID` (original value format: `c:120242825359230101`)
- Col 43: `Ad ID` (original value format: `a:120242825359460101`)

**1 column to replace:**
- Col 1: `Campaign Name` → user-specified new name

**All other columns:** preserve verbatim from FB API response

**Fetch steps:**
```typescript
// 1. GET campaign fields
GET /{campaignId}?fields=name,objective,buying_type,daily_budget,lifetime_budget,
  bid_strategy,status,special_ad_categories,start_time

// 2. GET ad sets
GET /{campaignId}/adsets?fields=name,daily_budget,lifetime_budget,
  optimization_goal,bid_amount,billing_event,status,targeting,start_time,
  destination_type,promoted_object

// 3. GET ads per ad set (with creative details)
GET /{adSetId}/ads?fields=name,status,creative{id,body,title,image_hash,
  image_file_name,video_id,call_to_action,link,object_story_spec,
  instagram_actor_id}
```

**TSV generation:**
```typescript
function generateTsv(rows: Row[]): Buffer {
  const lines = rows.map(r => COLUMNS.map(col => r[col] ?? '').join('\t'));
  const content = [COLUMNS.join('\t'), ...lines].join('\r\n');
  // UTF-16 LE with BOM
  const buf = Buffer.from('\uFFFE' + content, 'utf16le');
  return buf;
}
```

**Export function signature:**
```typescript
export async function fetchCampaignForTsvExport(
  token: string,
  campaignId: string,
  newCampaignName: string,
): Promise<Buffer>  // returns UTF-16 LE TSV buffer
```

### Step 4: Create `app/api/campaigns/[campaignId]/export-csv/route.ts`

```typescript
export async function GET(request: NextRequest, { params }: Params) {
  // Auth + token (same pattern)
  // Read query param: newName
  // Call fetchCampaignForTsvExport(token, campaignId, newName)
  // Return Response with headers:
  //   Content-Type: text/tab-separated-values; charset=utf-16le
  //   Content-Disposition: attachment; filename="campaign-export.csv"
  //   (FB Ads Manager expects .csv extension even though it's TSV)
}
```

## Todo List

- [ ] 1.1 Add `duplicateCampaignSameAccount` to `lib/facebook/campaign-actions.ts`
- [ ] 1.2 Add `POST` handler to `app/api/campaigns/[campaignId]/route.ts`
- [ ] 1.3 Create `lib/facebook/campaign-csv-export.ts` with fetch + CSV generation
- [ ] 1.4 Create `app/api/campaigns/[campaignId]/export-csv/route.ts`
- [ ] 1.5 Compile check — `npx tsc --noEmit`

## Success Criteria

- `POST /api/campaigns/{id}` creates same-account PAUSED copies with correct names/budgets
- `GET /api/campaigns/{id}/export-csv?newName=X` returns a downloadable file
- File is UTF-16 LE tab-delimited with BOM, `.csv` extension (matches FB's own export format)
- 63 columns in exact order matching FB's export template
- Campaign ID / Ad Set ID / Ad ID columns are empty (cleared for re-import)
- Campaign Name column = user-specified name
- All other fields populated from FB API response
- Zero TypeScript errors

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| FB API field names differ from TSV column headers | Column names confirmed from actual FB export file; use exact names from 63-column list above |
| Ad creative `image_hash` missing for video ads | Leave `Image Hash` blank; populate `Video ID` from creative; FB handles on import |
| `deep_copy=true` hits FB async limit (>51 ads) | Catch error, return partial success with note; most campaigns have <51 ads |
| TSV encoding issues (special chars in campaign names) | UTF-16 LE handles all Unicode including Vietnamese; test with VND campaigns |
| API fields don't map 1:1 to all 63 TSV columns | Many columns (e.g., `Buy With Prime Type`, `Is Budget Scheduling Enabled`) are meta-fields; default to empty string — FB will use account defaults on import |

## Security Considerations

- Token read server-side only; never exposed to client
- `campaignId` validated via auth — user must own the account that has this campaign (existing auth pattern)
- `newName` sanitized: strip any CSV injection chars (leading `=`, `+`, `-`, `@`)

## Next Steps

→ Phase 2: Frontend modal and ActionBar integration
