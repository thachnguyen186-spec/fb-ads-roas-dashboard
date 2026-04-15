/**
 * GET  /api/settings       → returns token + saved ad accounts
 * PATCH /api/settings      → saves token + upserts ad accounts with is_selected state
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const service = createServiceClient();

  const [profileRes, accountsRes] = await Promise.all([
    service.from('profiles').select('fb_access_token, role').eq('id', user.id).single(),
    service.from('fb_ad_accounts').select('account_id,name,is_selected,account_status,currency').eq('user_id', user.id),
  ]);

  const profile = profileRes.data as { fb_access_token?: string | null; role?: string } | null;
  return Response.json({
    has_token: !!profile?.fb_access_token,
    role: profile?.role ?? 'staff',
    accounts: accountsRes.data ?? [],
  });
}

interface AccountInput {
  account_id: string;
  name: string;
  is_selected: boolean;
  account_status?: number | null;
  currency?: string;
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  let body: { fb_access_token?: string | null; accounts?: AccountInput[] };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const service = createServiceClient();

  // Update FB token in profiles
  if ('fb_access_token' in body) {
    const { error } = await service
      .from('profiles')
      .update({ fb_access_token: body.fb_access_token ?? null })
      .eq('id', user.id);
    if (error) return errorResponse(error.message, 500);
  }

  // Upsert ad accounts
  if (Array.isArray(body.accounts) && body.accounts.length > 0) {
    const rows = body.accounts.map((a) => ({
      account_id: a.account_id,
      user_id: user.id,
      name: a.name,
      is_selected: a.is_selected,
      account_status: a.account_status ?? null,
      currency: a.currency ?? 'USD',
    }));

    const { error } = await service
      .from('fb_ad_accounts')
      .upsert(rows, { onConflict: 'account_id,user_id' });

    if (error) return errorResponse(error.message, 500);
  }

  return Response.json({ success: true });
}
