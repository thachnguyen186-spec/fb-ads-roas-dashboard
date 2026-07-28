/**
 * Builds campaign_id → website domain by scanning an ad account's ads for the
 * creative's destination link. Standard link ads expose it at
 * object_story_spec.link_data.link; Advantage+/dynamic-creative ads use
 * asset_feed_spec.link_urls[].website_url.
 *
 * A campaign can run ads with DIFFERENT destinations, so there is no single true
 * domain. We keep the domain of the highest-impression ad per campaign as the best
 * cheap proxy — this is one OBSERVED destination, NOT authoritative for the
 * campaign's full spend (surfaced with a UI caveat on the accounting export table).
 * Best-effort: malformed URLs are skipped, total failure returns an empty Map.
 */
import { fbGet } from './fb-client';

interface RawAdRow {
  campaign_id?: string;
  creative?: {
    object_story_spec?: { link_data?: { link?: string } };
    asset_feed_spec?: { link_urls?: { website_url?: string }[] };
  };
  insights?: { data?: { impressions?: string }[] };  // used to pick the most-shown ad
}
interface RawPage { data: RawAdRow[]; paging?: { cursors?: { after?: string }; next?: string } }

function toDomain(url?: string): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return null; }
}

export async function fetchCampaignDestinations(
  token: string,
  adAccountId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const bestImp = new Map<string, number>();  // impressions of the winning ad per campaign
  let after: string | undefined;
  try {
    do {
      const params: Record<string, string> = {
        fields: 'campaign_id,creative{object_story_spec{link_data{link}},asset_feed_spec{link_urls}},insights{impressions}',
        limit: '500',
      };
      if (after) params.after = after;
      const page = await fbGet(`/${adAccountId}/ads`, params, token) as RawPage;
      for (const ad of page.data ?? []) {
        const cid = ad.campaign_id;
        if (!cid) continue;
        const link = ad.creative?.object_story_spec?.link_data?.link
          ?? ad.creative?.asset_feed_spec?.link_urls?.[0]?.website_url;
        const domain = toDomain(link);
        if (!domain) continue;
        const imp = Number(ad.insights?.data?.[0]?.impressions ?? 0);
        if (!map.has(cid) || imp > (bestImp.get(cid) ?? -1)) {
          map.set(cid, domain);
          bestImp.set(cid, imp);
        }
      }
      after = page.paging?.cursors?.after;
      if (!page.paging?.next) break;
    } while (after);
  } catch {
    // Best-effort: destination enrichment is non-fatal (matches fetchAppNames)
  }
  return map;
}
