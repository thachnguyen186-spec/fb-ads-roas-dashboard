/**
 * GET  /api/snapshots  — list the current user's snapshots (id, name, created_at only)
 * POST /api/snapshots  — create a new snapshot { name, snapshot_data }
 */

import { createClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import type { SnapshotData } from '@/lib/types';

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const { data, error } = await supabase
    .from('campaign_snapshots')
    .select('id, name, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return errorResponse(error.message, 500);
  return Response.json({ snapshots: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const body = await request.json() as { name?: string; snapshot_data?: SnapshotData };
  const { name, snapshot_data } = body;
  if (!name?.trim()) return errorResponse('name is required', 400);
  if (!snapshot_data) return errorResponse('snapshot_data is required', 400);

  const { data, error } = await supabase
    .from('campaign_snapshots')
    .insert({ user_id: user.id, name: name.trim(), snapshot_data })
    .select('id')
    .single();

  if (error) return errorResponse(error.message, 500);
  return Response.json({ id: data.id }, { status: 201 });
}
