/**
 * PATCH /api/settings
 * Updates the authenticated user's FB credentials in the profiles table.
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const service = createServiceClient();
  const { data, error } = await service
    .from('profiles')
    .select('fb_access_token, fb_ad_account_id')
    .eq('id', user.id)
    .single();

  if (error) return errorResponse(error.message, 500);
  return Response.json(data);
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body');
  }

  const allowed = ['fb_access_token', 'fb_ad_account_id'];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0) {
    return errorResponse('No valid fields to update');
  }

  const service = createServiceClient();
  const { error } = await service
    .from('profiles')
    .update(updates)
    .eq('id', user.id);

  if (error) return errorResponse(error.message, 500);
  return Response.json({ success: true });
}
