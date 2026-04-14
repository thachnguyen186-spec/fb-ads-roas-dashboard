# Phase 01 — DB Schema + FB Settings

## Context Links
- Parent plan: [plan.md](./plan.md)
- Supabase schema: `C:\Work\Tools\fb-ads-tool\supabase\schema.sql`
- Workspace type: `C:\Work\Tools\fb-ads-tool\lib\types.ts`
- Settings API: `C:\Work\Tools\fb-ads-tool\app\api\workspaces\[id]\settings\route.ts`
- Settings form: `C:\Work\Tools\fb-ads-tool\app\workspaces\[id]\settings\components\workspace-settings-form.tsx`

## Overview
- **Date:** 2026-04-14
- **Priority:** P1 (blocker for all other phases)
- **Status:** pending
- **Description:** Add FB access token + ad account ID to the `workspaces` table and expose them through the existing settings UI/API.

## Key Insights
- `workspaces` table already stores other tokens (Shopify, Kie) — follow same pattern
- Settings PATCH route uses allowlist; add new fields there
- `Workspace` TypeScript type must be updated to match schema
- FB User Access Token expires every 60 days — UI must support re-entry
- Ad account ID format: `act_XXXXXXXX` — validate prefix on save

## Requirements
- Add `fb_access_token text` and `fb_ad_account_id text` columns to `workspaces` table
- Update TypeScript `Workspace` interface in `lib/types.ts`
- Extend settings PATCH API allowlist to include new fields
- Add "Facebook Ads Integration" section to settings form UI

## Architecture
```
Supabase workspaces table
  + fb_access_token text (nullable)
  + fb_ad_account_id text (nullable, format: act_XXXXXXXX)

PATCH /api/workspaces/[id]/settings
  allowed += ['fb_access_token', 'fb_ad_account_id']

WorkspaceSettingsForm
  + Facebook Ads Integration card
    - fb_ad_account_id input (text, placeholder: act_123456789)
    - fb_access_token input (password)
```

## Related Code Files

**Modify:**
- `C:\Work\Tools\fb-ads-tool\supabase\schema.sql` — add columns to `workspaces` table (comment block)
- `C:\Work\Tools\fb-ads-tool\lib\types.ts` — add fields to `Workspace` interface
- `C:\Work\Tools\fb-ads-tool\app\api\workspaces\[id]\settings\route.ts` — extend `allowed` array
- `C:\Work\Tools\fb-ads-tool\app\workspaces\[id]\settings\components\workspace-settings-form.tsx` — add FB card
- `C:\Work\Tools\fb-ads-tool\app\workspaces\[id]\layout.tsx` — add "Campaigns" tab (always unlocked)

**Supabase (run in SQL Editor):**
```sql
alter table workspaces add column if not exists fb_access_token text;
alter table workspaces add column if not exists fb_ad_account_id text;
```

## Implementation Steps
1. Run SQL migration in Supabase SQL Editor to add two columns
2. Update `lib/types.ts` — add `fb_access_token: string | null` and `fb_ad_account_id: string | null` to `Workspace`
3. Update `app/api/workspaces/[id]/settings/route.ts` — add `'fb_access_token'`, `'fb_ad_account_id'` to `allowed` array
4. Update `workspace-settings-form.tsx`:
   - Add state: `fbAdAccountId`, `fbAccessToken`
   - Add new card "Facebook Ads Integration" with two inputs
   - Include fields in `handleSave` JSON body
5. Update `layout.tsx` — push `{ label: 'Campaigns', href: \`${base}/campaigns\`, locked: false }` to `tabs` array

## Todo List
- [ ] Run Supabase migration (manual step)
- [ ] Update `Workspace` type in `lib/types.ts`
- [ ] Extend settings PATCH allowlist
- [ ] Add FB card to settings form
- [ ] Add Campaigns tab to workspace layout

## Success Criteria
- FB credentials can be saved and retrieved via settings form
- "Campaigns" tab appears in workspace nav (links to future page)
- TypeScript compiles without errors

## Risk Assessment
- **Token security:** Access token stored in plain text in DB (same as Shopify token pattern — acceptable for single-user tool)
- **Migration:** Must be run manually in Supabase dashboard; no automated migration runner configured

## Security Considerations
- Token is server-side only — never exposed to client (fetched via server component)
- Settings form uses `type="password"` to prevent shoulder surfing
- API validates workspace ownership before updating

## Next Steps
→ Phase 02: Use stored FB credentials to build the FB API client
