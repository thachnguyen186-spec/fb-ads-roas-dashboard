/**
 * GET /api/campaigns/[campaignId]/export-csv?name=<name1>&name=<name2>...
 * Fetches full campaign structure from FB API and returns a single UTF-16 LE TSV file
 * where rows are repeated for each ?name= param (one campaign block per name).
 * FB's "Import Ads in Bulk" creates one campaign per unique Campaign Name in the file.
 * Use for cross-account campaign duplication (download → manual import).
 */

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { errorResponse } from '@/lib/utils';
import { fetchCampaignForTsvExport, type AdsetBudgetOverride } from '@/lib/facebook/campaign-csv-export';

type Params = { params: Promise<{ campaignId: string }> };

type ExportBody = {
  names: string[];
  adset_budgets?: Array<{ name: string; amount: number; type: 'daily' | 'lifetime'; currency: string }>;
};

async function getToken(userId: string) {
  const service = createServiceClient();
  const { data: profile } = await service
    .from('profiles')
    .select('fb_access_token')
    .eq('id', userId)
    .single();
  return (profile as { fb_access_token?: string | null })?.fb_access_token ?? null;
}

function buildTsvResponse(tsvBuffer: Buffer) {
  return new Response(new Uint8Array(tsvBuffer), {
    headers: {
      'Content-Type': 'text/tab-separated-values; charset=utf-16le',
      'Content-Disposition': `attachment; filename="campaign-export.csv"`,
      'Content-Length': String(tsvBuffer.length),
    },
  });
}

/** Legacy GET — kept for backward compatibility (no adset budget overrides) */
export async function GET(request: NextRequest, { params }: Params) {
  const { campaignId } = await params;

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const token = await getToken(user.id);
  if (!token) return errorResponse('Facebook token not configured', 400);

  const names = request.nextUrl.searchParams.getAll('name').map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return errorResponse('At least one ?name= query parameter is required', 400);

  try {
    const tsvBuffer = await fetchCampaignForTsvExport(token, campaignId, names);
    return buildTsvResponse(tsvBuffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'FB API error';
    return errorResponse(message, 502);
  }
}

/** POST — supports adset budget overrides in JSON body */
export async function POST(request: NextRequest, { params }: Params) {
  const { campaignId } = await params;

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const token = await getToken(user.id);
  if (!token) return errorResponse('Facebook token not configured', 400);

  let body: ExportBody;
  try {
    body = await request.json() as ExportBody;
  } catch {
    return errorResponse('Invalid JSON body');
  }

  const names = (body.names ?? []).map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return errorResponse('At least one name is required', 400);

  // Build budget overrides map keyed by adset name
  let overridesMap: Map<string, AdsetBudgetOverride> | undefined;
  if (body.adset_budgets && body.adset_budgets.length > 0) {
    overridesMap = new Map(
      body.adset_budgets.map((b) => [b.name, { amount: b.amount, type: b.type, currency: b.currency }]),
    );
  }

  try {
    const tsvBuffer = await fetchCampaignForTsvExport(token, campaignId, names, overridesMap);
    return buildTsvResponse(tsvBuffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'FB API error';
    return errorResponse(message, 502);
  }
}
