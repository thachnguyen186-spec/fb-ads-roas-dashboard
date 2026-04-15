/**
 * GET    /api/snapshots/[id]  — fetch full snapshot (id, name, created_at, snapshot_data)
 * DELETE /api/snapshots/[id]  — delete snapshot owned by current user
 */

import { createClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';

interface Params { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const { data, error } = await supabase
    .from('campaign_snapshots')
    .select('id, name, created_at, snapshot_data')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error || !data) return errorResponse('Snapshot not found', 404);
  return Response.json(data);
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const { error } = await supabase
    .from('campaign_snapshots')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return errorResponse(error.message, 500);
  return Response.json({ ok: true });
}
