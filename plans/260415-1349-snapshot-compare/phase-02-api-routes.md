# Phase 2 — API Routes

## Files to create
- `app/api/snapshots/route.ts` — GET list, POST create
- `app/api/snapshots/[id]/route.ts` — DELETE

## GET /api/snapshots
Returns `[{id, name, created_at}]` for the current user (no data blob — lightweight).

## POST /api/snapshots
Body: `{ name: string, snapshot_data: SnapshotData }`
Returns: `{ id: string }`

## DELETE /api/snapshots/[id]
Deletes snapshot if owned by current user.
Returns: `{ ok: true }` or 404.

## Auth pattern (mirrors existing routes)
```typescript
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
```
RLS on DB ensures ownership — no extra check needed.
