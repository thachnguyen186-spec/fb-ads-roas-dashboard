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
import { fetchCampaignForTsvExport } from '@/lib/facebook/campaign-csv-export';

type Params = { params: Promise<{ campaignId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
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

  // Accept repeated ?name= params: ?name=Copy+1&name=Copy+2
  const names = request.nextUrl.searchParams.getAll('name').map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return errorResponse('At least one ?name= query parameter is required', 400);

  try {
    const tsvBuffer = await fetchCampaignForTsvExport(token, campaignId, names);

    // Use Uint8Array, not tsvBuffer.buffer — Buffer.buffer returns the full underlying
    // ArrayBuffer which may include extra bytes before/after the actual data.
    return new Response(new Uint8Array(tsvBuffer), {
      headers: {
        'Content-Type': 'text/tab-separated-values; charset=utf-16le',
        // FB Ads Manager expects .csv extension even though content is TSV
        'Content-Disposition': `attachment; filename="campaign-export.csv"`,
        'Content-Length': String(tsvBuffer.length),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'FB API error';
    return errorResponse(message, 502);
  }
}
