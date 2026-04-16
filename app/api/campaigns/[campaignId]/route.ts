/**
 * PATCH /api/campaigns/[campaignId]
 * Executes campaign actions via FB API on behalf of the authenticated user.
 * Supported actions: pause, budget update.
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { pauseCampaign, enableCampaign, updateBudget, duplicateCampaignSameAccount, type AdsetBudgetSpec } from '@/lib/facebook/campaign-actions';

type Params = { params: Promise<{ campaignId: string }> };

type ActionBody =
  | { action: 'pause' }
  | { action: 'enable' }
  | { action: 'budget'; budget_type: 'daily' | 'lifetime'; amount: number; currency: string };

type CopySpec = { name: string; budget_amount?: number; budget_type?: 'daily' | 'lifetime' };

type DuplicateBody = {
  action: 'duplicate';
  source_account_id: string;
  currency: string;
  copies: CopySpec[];
  /** Per-adset budget overrides applied to every copy — keyed by adset name */
  adset_budgets?: Array<{ name: string; amount: number; type: 'daily' | 'lifetime' }>;
};

export async function PATCH(request: NextRequest, { params }: Params) {
  const { campaignId } = await params;

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const service = createServiceClient();
  const { data: profile } = await service
    .from('profiles')
    .select('fb_access_token')
    .eq('id', user.id)
    .single();

  const token = (profile as { fb_access_token?: string | null })?.fb_access_token;
  if (!token) return errorResponse('Facebook token not configured', 400);

  let body: ActionBody;
  try {
    body = await request.json() as ActionBody;
  } catch {
    return errorResponse('Invalid JSON body');
  }

  try {
    if (body.action === 'pause') {
      await pauseCampaign(token, campaignId);
      return Response.json({ success: true });
    }

    if (body.action === 'enable') {
      await enableCampaign(token, campaignId);
      return Response.json({ success: true });
    }

    if (body.action === 'budget') {
      const { budget_type, amount, currency } = body;
      if (!budget_type || !amount || amount <= 0) {
        return errorResponse('Invalid budget: amount must be > 0');
      }
      await updateBudget(token, campaignId, budget_type, amount, currency);
      return Response.json({ success: true });
    }

    return errorResponse('Unknown action');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'FB API error';
    return errorResponse(message, 502);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { campaignId } = await params;

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const service = createServiceClient();
  const { data: profile } = await service
    .from('profiles')
    .select('fb_access_token')
    .eq('id', user.id)
    .single();

  const token = (profile as { fb_access_token?: string | null })?.fb_access_token;
  if (!token) return errorResponse('Facebook token not configured', 400);

  let body: DuplicateBody;
  try {
    body = await request.json() as DuplicateBody;
  } catch {
    return errorResponse('Invalid JSON body');
  }

  if (body.action !== 'duplicate') return errorResponse('Unknown action');

  const { copies, currency, adset_budgets } = body;
  if (!Array.isArray(copies) || copies.length < 1 || copies.length > 10) {
    return errorResponse('copies must be an array of 1-10 items');
  }
  if (copies.some((c) => !c.name?.trim())) {
    return errorResponse('All copies must have a non-empty name');
  }

  // Build adset budget specs with currency for all copies
  const adsetBudgetSpecs: AdsetBudgetSpec[] | undefined = adset_budgets?.length
    ? adset_budgets.map((b) => ({ name: b.name, amount: b.amount, type: b.type, currency }))
    : undefined;

  const results: Array<{ name: string; success: boolean; campaign_id?: string; error?: string }> = [];

  for (const copy of copies) {
    try {
      const budgetOverride = copy.budget_amount && copy.budget_type
        ? { amount: copy.budget_amount, type: copy.budget_type, currency }
        : undefined;
      const newId = await duplicateCampaignSameAccount(
        token, campaignId, copy.name.trim(), budgetOverride, adsetBudgetSpecs,
      );
      results.push({ name: copy.name, success: true, campaign_id: newId });
    } catch (err) {
      results.push({ name: copy.name, success: false, error: err instanceof Error ? err.message : 'FB API error' });
    }
  }

  return Response.json({ results });
}
