/**
 * campaign_id → { target_type, target_label } by scanning /adgroup/get/.
 * app-promotion → literal app_id (no name lookup exists for TikTok); website → bare domain.
 *
 * Field names (app_id, promotion_type, landing_page_url) were unconfirmed against a live
 * response at plan time. Missing fields are logged (keys only, never full row) and fall back
 * to 'unknown' — mirrors resolveStatus() in campaigns.ts so a wrong guess is diagnosable from
 * Vercel logs instead of silently mis-rendering every row.
 */
import { tiktokGet } from './tiktok-client';

export type TargetType = 'app' | 'website' | 'unknown';
export interface CampaignTarget { target_type: TargetType; target_label: string }

interface RawAdGroupTarget {
  campaign_id?: string;
  app_id?: string;
  promotion_type?: string;
  landing_page_url?: string;
}

function domainOf(url?: string): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

function classify(raw: RawAdGroupTarget): CampaignTarget {
  if (raw.app_id) return { target_type: 'app', target_label: raw.app_id };
  const domain = domainOf(raw.landing_page_url);
  if (domain) return { target_type: 'website', target_label: domain };
  console.warn('[tiktok] no app_id/landing_page_url for adgroup — keys:', Object.keys(raw));
  return { target_type: 'unknown', target_label: 'Unknown' };
}

export async function fetchCampaignTargets(
  token: string,
  advertiserId: string,
): Promise<Map<string, CampaignTarget>> {
  const map = new Map<string, CampaignTarget>();
  let page = 1;
  for (;;) {
    const data = await tiktokGet<{ list: RawAdGroupTarget[]; page_info: { total_number: number } }>(
      '/adgroup/get/',
      {
        advertiser_id: advertiserId,
        // Required — without it TikTok returns only default fields and
        // app_id/promotion_type/landing_page_url are always absent.
        fields: JSON.stringify(['campaign_id', 'app_id', 'promotion_type', 'landing_page_url']),
        page: String(page),
        page_size: '100',
      },
      token,
    );
    const batch = data.list ?? [];
    for (const raw of batch) {
      const cid = raw.campaign_id;
      if (!cid || map.has(cid)) continue;
      map.set(cid, classify(raw));
    }
    if (batch.length === 0 || page * 100 >= data.page_info.total_number) break;
    page += 1;
  }
  return map;
}
