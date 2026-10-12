/**
 * GET  /api/snapshots?platform=facebook|tiktok  — list the user's snapshots for that platform (default facebook)
 * POST /api/snapshots  — create a snapshot { name, snapshot_data, platform? } (platform default facebook)
 */

import { createClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import type { SnapshotData } from '@/lib/types';

const PLATFORMS = ['facebook', 'tiktok'] as const;
type Platform = typeof PLATFORMS[number];

function parsePlatform(raw: unknown): Platform | null {
  if (raw === undefined || raw === null || raw === '') return 'facebook';
  return PLATFORMS.find((p) => p === raw) ?? null;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const platform = parsePlatform(new URL(request.url).searchParams.get('platform'));
  if (!platform) return errorResponse('platform must be facebook or tiktok', 400);

  const { data, error } = await supabase
    .from('campaign_snapshots')
    .select('id, name, created_at')
    .eq('user_id', user.id)
    .eq('platform', platform)
    .order('created_at', { ascending: false });

  if (error) return errorResponse(error.message, 500);
  return Response.json({ snapshots: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const body = await request.json().catch(() => null) as { name?: string; snapshot_data?: SnapshotData; platform?: string } | null;
  if (!body) return errorResponse('Invalid JSON body', 400);
  const { name, snapshot_data } = body;
  if (!name?.trim()) return errorResponse('name is required', 400);
  if (!snapshot_data) return errorResponse('snapshot_data is required', 400);
  const platform = parsePlatform(body.platform);
  if (!platform) return errorResponse('platform must be facebook or tiktok', 400);

  const { data, error } = await supabase
    .from('campaign_snapshots')
    .insert({ user_id: user.id, name: name.trim(), snapshot_data, platform })
    .select('id')
    .single();

  if (error) return errorResponse(error.message, 500);
  return Response.json({ id: data.id }, { status: 201 });
}
