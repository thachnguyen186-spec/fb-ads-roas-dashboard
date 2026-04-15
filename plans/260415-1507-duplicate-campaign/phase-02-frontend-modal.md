# Phase 2: Frontend — DuplicateCampaignModal + ActionBar Integration

## Context Links

- [plan.md](./plan.md)
- [Phase 1: Backend API](./phase-01-backend-api.md)
- Source: `app/dashboard/components/action-bar.tsx`
- Source: `app/dashboard/components/campaign-hub.tsx`
- Reference: `app/dashboard/components/budget-modal.tsx` (modal pattern)

## Overview

- **Priority:** P2
- **Status:** Pending (depends on Phase 1)
- **Description:** Modal with two distinct UX flows depending on same vs cross-account. Same-account: multi-copy form → API call → done. Cross-account: name edit → CSV download → instructions.

## Key Insights

1. **Two-mode modal** — destination account selection determines the mode. Mode switch replaces the form body (not a tab — just conditional rendering).
2. **Same-account mode** — copy count picker + per-copy name/budget rows. Existing `singleCampaign` pattern in ActionBar means Duplicate only shows for 1 campaign.
3. **Cross-account mode** — single name input + download button. No copy count (CSV is one campaign per export). Download triggers `GET /api/campaigns/[id]/export-csv?newName=...` as a browser download.
4. **CSV download UX** — use `<a href="..." download>` pattern with a blob URL, or open the API route directly in a new tab. Simplest: `window.open(url)` with auth cookie sent automatically (same-origin GET).
5. **Post-download instructions** — after CSV download, show an info panel: "Upload this file to [destination account] in Facebook Ads Manager → Import Ads in Bulk → Publish." Link to FB help page.
6. **ActionBar change is minimal** — add `allAccounts` prop + `showDuplicate` state + render modal. Existing `singleCampaign` variable already handles visibility.

## Requirements

### Functional
- FR1: Duplicate button visible only when exactly 1 campaign selected
- FR2: Destination account dropdown — all user accounts, default = source account
- FR3: Same-account mode: copy count (1-10), per-copy name + optional budget
- FR4: Cross-account mode: single campaign name input + CSV download button
- FR5: Cross-account: after download, show upload instructions with FB Ads Manager link
- FR6: Same-account: submit → loading → per-copy results → auto-close on full success
- FR7: CBO campaigns (budget_type=unknown): hide budget input, show "Budget managed at ad set level"

### Non-Functional
- NFR1: Modal under 200 lines
- NFR2: No new npm dependencies
- NFR3: Works at all zoom levels (uses fixed overlay, not relative positioning)

## Architecture

```
CampaignHub
  ├─ selectedAccounts: FbAdAccount[]
  └─ ActionBar (+ allAccounts prop)
       ├─ singleCampaign (existing)
       ├─ [Duplicate] button → setShowDuplicate(true)
       └─ DuplicateCampaignModal
            ├─ Props: campaign, allAccounts, onClose, onComplete
            ├─ State: destAccountId, copyCount, copies[], submitting, results, csvReady
            ├─ Derived: isCrossAccount = destAccountId !== campaign.account_id
            ├─ Same-account submit → POST /api/campaigns/[id]
            └─ Cross-account download → GET /api/campaigns/[id]/export-csv?newName=...
```

## Related Code Files

### Create
- `app/dashboard/components/duplicate-campaign-modal.tsx`

### Modify
- `app/dashboard/components/action-bar.tsx` — add `allAccounts` prop, Duplicate button, modal
- `app/dashboard/components/campaign-hub.tsx` — pass `selectedAccounts` as `allAccounts`

## Implementation Steps

### Step 1: Create `duplicate-campaign-modal.tsx`

**Props:**
```typescript
interface Props {
  campaign: MergedCampaign;
  allAccounts: FbAdAccount[];
  onClose: () => void;
  onComplete: () => void;
}
```

**State:**
```typescript
const [destAccountId, setDestAccountId] = useState(campaign.account_id);
const [copyCount, setCopyCount] = useState(1);
const [copies, setCopies] = useState([{ name: `Copy of ${campaign.campaign_name}`, budget: '' }]);
const [submitting, setSubmitting] = useState(false);
const [results, setResults] = useState<Array<{ name: string; success: boolean; error?: string }> | null>(null);
const [csvDownloaded, setCsvDownloaded] = useState(false);
```

**Derived:**
```typescript
const isCrossAccount = destAccountId !== campaign.account_id;
const destAccount = allAccounts.find(a => a.account_id === destAccountId) ?? allAccounts[0];
const hasBudget = campaign.budget_type !== 'unknown';
```

**Same-account submit:**
```typescript
async function handleSameAccountSubmit() {
  setSubmitting(true);
  const res = await fetch(`/api/campaigns/${campaign.campaign_id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'duplicate',
      source_account_id: campaign.account_id,
      copies: copies.map(c => ({
        name: c.name,
        ...(c.budget && hasBudget ? {
          budget_amount: parseFloat(c.budget),
          budget_type: campaign.budget_type,
        } : {}),
      })),
    }),
  });
  const data = await res.json();
  setSubmitting(false);
  setResults(data.results ?? []);
  if (data.results?.every((r: { success: boolean }) => r.success)) {
    setTimeout(onComplete, 1200);
  }
}
```

**Cross-account CSV download:**
```typescript
function handleCsvDownload() {
  const newName = copies[0].name;  // only 1 name for cross-account
  const url = `/api/campaigns/${campaign.campaign_id}/export-csv?newName=${encodeURIComponent(newName)}`;
  window.open(url, '_blank');  // browser downloads the file (.csv extension, UTF-16 LE TSV)
  setCsvDownloaded(true);
}
```

**Layout:**
```
fixed inset-0 z-50 bg-black/60 flex items-center justify-center
  → bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4
    → Header: "Duplicate Campaign" + × close button
    → Source info: campaign name (truncated), account, budget
    → Destination account: <select> all accounts
    
    IF same-account:
      → Copy count: <select> 1-10 (updates copies array)
      → Per-copy rows (max-h-64 overflow-y-auto):
          Name input (required) + Budget input (optional, hidden if CBO)
      → Results panel (after submit): green ✓ / red ✗ per copy
      → Footer: [Cancel] [Duplicate →]

    IF cross-account:
      → Campaign name input (single, required)
      → Amber info box: "Campaign + ad sets + ads will be exported.
          Upload the downloaded CSV to [destination account] in Facebook Ads Manager
          → Campaigns → Import Ads in Bulk."
      → [Download CSV] button
      IF csvDownloaded:
        → Green success panel: "CSV downloaded. Open Facebook Ads Manager for
          [destination account name] and import the file."
          [Open Ads Manager ↗] button (link to business.facebook.com/adsmanager)
      → Footer: [Close]
```

**Copy count behavior:**
```typescript
function handleCopyCountChange(n: number) {
  setCopyCount(n);
  setCopies(prev => {
    const next = [...prev];
    while (next.length < n) {
      next.push({ name: `Copy of ${campaign.campaign_name} ${next.length + 1}`, budget: '' });
    }
    return next.slice(0, n);
  });
}
```
Note: When count = 1, don't append " 1" to name. When count > 1, append index number.

### Step 2: Modify `action-bar.tsx`

**Add prop:**
```typescript
interface Props {
  selectedCampaigns: MergedCampaign[];
  allAccounts: FbAdAccount[];   // NEW
  onActionComplete: () => void;
  onDeselect: () => void;
  vndRate: number;
}
```

**Add state + button:**
```typescript
const [showDuplicate, setShowDuplicate] = useState(false);

// In JSX, after "Update Budget" button:
{singleCampaign && (
  <button
    onClick={() => setShowDuplicate(true)}
    disabled={actionState === 'loading'}
    className="px-4 py-1.5 text-sm bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 transition-colors"
  >
    Duplicate
  </button>
)}

// At bottom of fragment, after BudgetModal:
{showDuplicate && singleCampaign && (
  <DuplicateCampaignModal
    campaign={singleCampaign}
    allAccounts={allAccounts}
    onClose={() => setShowDuplicate(false)}
    onComplete={() => { setShowDuplicate(false); onActionComplete(); }}
  />
)}
```

**Add import:**
```typescript
import DuplicateCampaignModal from './duplicate-campaign-modal';
import type { FbAdAccount } from '@/lib/types';
```

### Step 3: Modify `campaign-hub.tsx`

One-line change — pass `selectedAccounts` to ActionBar:

```tsx
<ActionBar
  selectedCampaigns={selectedCampaigns}
  allAccounts={selectedAccounts}        // NEW
  onActionComplete={...}
  onDeselect={...}
  vndRate={vndRate}
/>
```

## Todo List

- [ ] 2.1 Create `app/dashboard/components/duplicate-campaign-modal.tsx`
- [ ] 2.2 Add `allAccounts` prop + Duplicate button + modal to `action-bar.tsx`
- [ ] 2.3 Pass `selectedAccounts` as `allAccounts` in `campaign-hub.tsx`
- [ ] 2.4 Compile check — `npx tsc --noEmit`
- [ ] 2.5 Test: single campaign selected → Duplicate button appears
- [ ] 2.6 Test: multi-campaign selected → Duplicate button hidden
- [ ] 2.7 Test same-account: modal switches to copy-count form, copies created PAUSED
- [ ] 2.8 Test cross-account: modal shows name input + download, CSV file downloads

## Success Criteria

- Duplicate button only with exactly 1 campaign selected
- Same-account: N copies created as PAUSED with correct names; results shown per copy
- Cross-account: CSV downloads with IDs cleared and correct campaign name
- CBO campaigns hide budget input with note
- Auto-close after all-success (same-account)
- Cross-account shows upload instructions + Ads Manager link after download
- No TypeScript errors

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Modal >200 lines | Extract `CopyRow` as inline render function, not component |
| `allAccounts` empty edge case | Hide Duplicate button if `allAccounts.length === 0`; show tooltip |
| CSV download blocked by browser popup blocker | Use `<a>` element click instead of `window.open` |
| Long campaign names overflow inputs | `title` attribute on truncated display; inputs are full-width |

## Security Considerations

- No token in frontend; CSV download goes through authenticated API route (cookie-based)
- `newName` for CSV sanitized server-side against CSV injection

## Next Steps

- End-to-end test with real FB account
- Future: support downloading CSV for multiple selected campaigns as a zip
