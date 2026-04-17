# Phase 1 — DB Migration + Types

## Overview
Add `campaign_snapshots` table to Supabase and snapshot-related types to `lib/types.ts`.

## Files to modify
- `supabase/schema.sql` — append migration SQL
- `lib/types.ts` — add SnapshotRow, SnapshotAdSetRow, SnapshotData, SnapshotMeta

## DB Schema
```sql
create table if not exists public.campaign_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  snapshot_data jsonb not null,  -- { campaigns: SnapshotRow[], adsets: SnapshotAdSetRow[] }
  created_at timestamptz default now() not null
);
alter table public.campaign_snapshots enable row level security;
create policy "Users manage own snapshots"
  on public.campaign_snapshots for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

## Types to add (lib/types.ts)
```typescript
export interface SnapshotRow {
  campaign_id: string;
  campaign_name: string;
  roas: number | null;
  profit_pct: number | null;
}

export interface SnapshotAdSetRow {
  adset_id: string;
  campaign_id: string;
  adset_name: string;
  roas: number | null;
  profit_pct: number | null;
}

export interface SnapshotData {
  campaigns: SnapshotRow[];
  adsets: SnapshotAdSetRow[];
}

export interface SnapshotMeta {
  id: string;
  name: string;
  created_at: string;
}
```

## Implementation Steps
1. Append migration SQL to `supabase/schema.sql`
2. Add 4 interfaces to end of `lib/types.ts`
3. Run migration in Supabase SQL editor (manual step, document in comment)
