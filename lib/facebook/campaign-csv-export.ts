/**
 * Fetches full campaign structure from FB API and generates a UTF-16 LE TSV buffer
 * matching Facebook Ads Manager's own export format (63 columns).
 * The file can be re-imported via "Import Ads from Spreadsheet" in another ad account.
 *
 * Key rules:
 * - Campaign ID / Ad Set ID / Ad ID are cleared (empty) so FB creates new objects
 * - Campaign Name is replaced with user-specified name
 * - All other columns preserved verbatim
 * - Encoding: UTF-16 LE with BOM (\uFFFE)
 * - Delimiter: tab (\t), line endings: \r\n
 */

import { fbGet } from './fb-client';

// 63 columns in exact order matching FB's own export template
const COLUMNS = [
  'Campaign ID',
  'Campaign Name',
  'Campaign Status',
  'Campaign Objective',
  'Buying Type',
  'Campaign Bid Strategy',
  'Campaign Start Time',
  'New Objective',
  'Buy With Prime Type',
  'Is Budget Scheduling Enabled For Campaign',
  'Campaign High Demand Periods',
  'Buy With Integration Partner',
  'Ad Set ID',
  'Ad Set Run Status',
  'Ad Set Lifetime Impressions',
  'Ad Set Name',
  'Ad Set Time Start',
  'Ad Set Daily Budget',
  'Destination Type',
  'Ad Set Lifetime Budget',
  'Is Budget Scheduling Enabled For Ad Set',
  'Ad Set High Demand Periods',
  'Link Object ID',
  'Optimized Event',
  'Link',
  'Application ID',
  'Object Store URL',
  'Global Regions',
  'Location Types',
  'Excluded Countries',
  'Age Min',
  'Age Max',
  'Advantage Audience',
  'Age Range',
  'Targeting Optimization',
  'Beneficiary',
  'Payer',
  'User Device',
  'User Operating System',
  'Brand Safety Inventory Filtering Levels',
  'Optimization Goal',
  'Attribution Spec',
  'Billing Event',
  'Ad ID',
  'Ad Status',
  'Preview Link',
  'Instagram Preview Link',
  'Ad Name',
  'Title',
  'Body',
  'Optimize text per person',
  'Optimized Ad Creative',
  'Image Hash',
  'Image File Name',
  'Creative Type',
  'Video ID',
  'Video File Name',
  'Instagram Account ID',
  'Call to Action',
  'Additional Custom Tracking Specs',
  'Video Retargeting',
  'Permalink',
  'Use Page as Actor',
] as const;

type Row = Record<string, string>;

// Strip CSV injection characters from user-supplied text
function sanitizeName(name: string): string {
  return name.replace(/^[=+\-@\t\r\n]+/, '').trim();
}

/**
 * FB API returns enum values for several fields, but the Ads Manager CSV importer
 * expects the human-readable display names shown in the UI. These maps convert them.
 */
const BID_STRATEGY_MAP: Record<string, string> = {
  LOWEST_COST_WITHOUT_CAP: 'Lowest Cost',
  LOWEST_COST_WITH_BID_CAP: 'Lowest Cost With Bid Cap',
  COST_CAP: 'Cost Cap',
  HIGHEST_VALUE: 'Highest Value',
  TARGET_COST: 'Target Cost',
  MINIMUM_ROAS: 'ROAS goal',
};

const OBJECTIVE_MAP: Record<string, string> = {
  OUTCOME_APP_PROMOTION: 'App Promotion',
  OUTCOME_AWARENESS: 'Outcome Awareness',
  OUTCOME_ENGAGEMENT: 'Outcome Engagement',
  OUTCOME_LEADS: 'Outcome Leads',
  OUTCOME_SALES: 'Outcome Sales',
  OUTCOME_TRAFFIC: 'Outcome Traffic',
  APP_INSTALLS: 'App Installs',
  BRAND_AWARENESS: 'Brand Awareness',
  CONVERSIONS: 'Conversions',
  LEAD_GENERATION: 'Lead Generation',
  LINK_CLICKS: 'Clicks to Website',
  MESSAGES: 'Messages',
  PAGE_LIKES: 'Page Likes',
  REACH: 'Reach',
  VIDEO_VIEWS: 'Video Views',
  STORE_VISITS: 'Store Visits',
  STORE_TRAFFIC: 'Store Traffic',
  PRODUCT_CATALOG_SALES: 'Catalog Sales',
  EVENT_RESPONSES: 'Event Responses',
  LOCAL_AWARENESS: 'Local Awareness',
};

/** Map API enum → display name, falling back to the original value if unmapped. */
function mapEnum(map: Record<string, string>, value: string | undefined): string {
  if (!value) return '';
  return map[value] ?? value;
}

function budgetCents(val: string | undefined): string {
  if (!val) return '';
  // FB API returns budgets in cents for USD; return as-is
  return val;
}

interface FbCampaign {
  id: string;
  name: string;
  status: string;
  objective?: string;
  buying_type?: string;
  bid_strategy?: string;
  start_time?: string;
  daily_budget?: string;
  lifetime_budget?: string;
}

interface FbAdSet {
  id: string;
  name: string;
  status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  optimization_goal?: string;
  bid_amount?: string;
  billing_event?: string;
  start_time?: string;
  destination_type?: string;
  targeting?: {
    age_min?: number;
    age_max?: number;
    geo_locations?: { countries?: string[] };
    excluded_geo_locations?: { countries?: string[] };
    device_platforms?: string[];
    user_os?: string[];
  };
  promoted_object?: { application_id?: string; object_store_url?: string; pixel_id?: string; custom_event_type?: string };
  // Nested ads — populated when fetching adsets with ads{...} subfields
  ads?: { data: FbAd[] };
}

interface FbCreative {
  id?: string;
  body?: string;
  title?: string;
  image_hash?: string;
  video_id?: string;
  instagram_actor_id?: string;
  // link and call_to_action are nested inside object_story_spec, not top-level
  object_story_spec?: {
    link_data?: { link?: string; call_to_action?: { type?: string } };
    video_data?: { video_id?: string; call_to_action?: { type?: string } };
  };
}

interface FbAd {
  id: string;
  name: string;
  status: string;
  creative?: FbCreative;
}

function buildRow(
  campaign: FbCampaign,
  adSet: FbAdSet,
  ad: FbAd | null,
  newCampaignName: string,
): Row {
  const creative = ad?.creative;
  const targeting = adSet.targeting ?? {};
  const promotedObj = adSet.promoted_object ?? {};

  // CTA type lives inside object_story_spec (not a top-level creative field)
  const ctaType = creative?.object_story_spec?.link_data?.call_to_action?.type
    ?? creative?.object_story_spec?.video_data?.call_to_action?.type
    ?? '';

  // Link lives inside object_story_spec.link_data (not a top-level creative field)
  const link = creative?.object_story_spec?.link_data?.link ?? '';

  // video_id is a valid top-level creative field; also available in object_story_spec
  const videoId = creative?.video_id
    ?? creative?.object_story_spec?.video_data?.video_id
    ?? '';

  const countries = targeting.geo_locations?.countries?.join(',') ?? '';
  const excludedCountries = targeting.excluded_geo_locations?.countries?.join(',') ?? '';
  const devices = targeting.device_platforms?.join(',') ?? '';
  const userOs = targeting.user_os?.join(',') ?? '';

  // Detect creative type — FB importer expects display names, not API enums
  const creativeType = videoId
    ? 'Video Page Post Ad'
    : creative?.image_hash
      ? (link ? 'Link Page Post Ad' : 'Photo Page Post Ad')
      : '';

  const row: Row = {
    'Campaign ID': '',                          // cleared for re-import
    'Campaign Name': sanitizeName(newCampaignName),
    'Campaign Status': campaign.status ?? '',
    'Campaign Objective': mapEnum(OBJECTIVE_MAP, campaign.objective),
    'Buying Type': campaign.buying_type ?? '',
    'Campaign Bid Strategy': mapEnum(BID_STRATEGY_MAP, campaign.bid_strategy),
    'Campaign Start Time': campaign.start_time ?? '',
    'New Objective': '',
    'Buy With Prime Type': '',
    'Is Budget Scheduling Enabled For Campaign': '',
    'Campaign High Demand Periods': '',
    'Buy With Integration Partner': '',
    'Ad Set ID': '',                            // cleared for re-import
    'Ad Set Run Status': adSet.status ?? '',
    'Ad Set Lifetime Impressions': '',
    'Ad Set Name': adSet.name ?? '',
    'Ad Set Time Start': adSet.start_time ?? '',
    'Ad Set Daily Budget': budgetCents(adSet.daily_budget),
    'Destination Type': adSet.destination_type ?? '',
    'Ad Set Lifetime Budget': budgetCents(adSet.lifetime_budget),
    'Is Budget Scheduling Enabled For Ad Set': '',
    'Ad Set High Demand Periods': '',
    'Link Object ID': promotedObj.pixel_id ?? '',
    'Optimized Event': promotedObj.custom_event_type ?? '',
    'Link': link,
    'Application ID': promotedObj.application_id ?? '',
    'Object Store URL': promotedObj.object_store_url ?? '',
    'Global Regions': '',
    'Location Types': '',
    'Excluded Countries': excludedCountries,
    'Age Min': targeting.age_min ? String(targeting.age_min) : '',
    'Age Max': targeting.age_max ? String(targeting.age_max) : '',
    'Advantage Audience': '',
    'Age Range': '',
    'Targeting Optimization': '',
    'Beneficiary': '',
    'Payer': '',
    'User Device': devices,
    'User Operating System': userOs,
    'Brand Safety Inventory Filtering Levels': '',
    'Optimization Goal': adSet.optimization_goal ?? '',
    'Attribution Spec': '',
    'Billing Event': adSet.billing_event ?? '',
    'Ad ID': '',                                // cleared for re-import
    'Ad Status': ad?.status ?? '',
    'Preview Link': '',
    'Instagram Preview Link': '',
    'Ad Name': ad?.name ?? '',
    'Title': creative?.title ?? '',
    'Body': creative?.body ?? '',
    'Optimize text per person': '',
    'Optimized Ad Creative': '',
    'Image Hash': creative?.image_hash ?? '',
    'Image File Name': '',   // image_file_name is not a valid FB API field
    'Creative Type': creativeType,
    'Video ID': videoId,
    'Video File Name': '',
    'Instagram Account ID': creative?.instagram_actor_id ?? '',
    'Call to Action': ctaType,
    'Additional Custom Tracking Specs': '',
    'Video Retargeting': '',
    'Permalink': '',
    'Use Page as Actor': '',
  };

  // If no ad, leave ad-level fields empty but still emit a row for the ad set
  if (!ad) {
    row['Ad ID'] = '';
    row['Ad Status'] = '';
    row['Ad Name'] = '';
  }

  // Apply campaign budget at campaign level if present
  if (campaign.daily_budget) {
    // Campaign-level budget — ad set budgets should be empty in this case
    row['Ad Set Daily Budget'] = '';
    row['Ad Set Lifetime Budget'] = '';
  }

  return row;
}

function generateTsv(rows: Row[]): Buffer {
  const lines = rows.map((r) => COLUMNS.map((col) => r[col] ?? '').join('\t'));
  const content = [COLUMNS.join('\t'), ...lines].join('\r\n');
  // UTF-16 LE with BOM: U+FEFF (\uFEFF) encodes to bytes FF FE in little-endian
  return Buffer.from('\uFEFF' + content, 'utf16le');
}

// Ad fields for nested fetch inside adsets
// Only top-level creative fields that FB Graph API actually exposes.
// link and call_to_action are NOT top-level — they live inside object_story_spec.
// buildRow already reads them from object_story_spec as the primary source.
const AD_FIELDS = 'name,status,creative{id,body,title,image_hash,video_id,instagram_actor_id,object_story_spec}';

/**
 * Fetches campaign structure once, then generates a single TSV where the rows
 * are repeated for each name in newCampaignNames.
 * FB's importer treats each unique Campaign Name as a separate campaign to create.
 *
 * @param newCampaignNames - 1-10 names; each produces its own campaign block in the TSV
 */
export async function fetchCampaignForTsvExport(
  token: string,
  campaignId: string,
  newCampaignNames: string[],
): Promise<Buffer> {
  if (newCampaignNames.length === 0) throw new Error('At least one campaign name is required');

  // 2 total API calls regardless of adset/copy count — avoids Vercel 10s timeout.

  // Call 1: Fetch campaign metadata
  const campaignRes = await fbGet(
    `/${campaignId}`,
    { fields: 'name,status,objective,buying_type,bid_strategy,start_time,daily_budget,lifetime_budget' },
    token,
  ) as FbCampaign;

  // Call 2: Fetch all ad sets with nested ads in a single request
  const adSetsRes = await fbGet(
    `/${campaignId}/adsets`,
    {
      fields: `name,status,daily_budget,lifetime_budget,optimization_goal,billing_event,start_time,destination_type,targeting,promoted_object,ads{${AD_FIELDS}}`,
      limit: '200',
    },
    token,
  ) as { data: FbAdSet[] };

  const adSets = adSetsRes.data ?? [];

  // Build base rows for the campaign structure (using a placeholder name — will be replaced per copy)
  function buildRowsForName(name: string): Row[] {
    if (adSets.length === 0) {
      return [buildRow(campaignRes, { id: '', name: '', status: '' }, null, name)];
    }
    const rows: Row[] = [];
    for (const adSet of adSets) {
      const ads = adSet.ads?.data ?? [];
      if (ads.length === 0) {
        rows.push(buildRow(campaignRes, adSet, null, name));
      } else {
        for (const ad of ads) {
          rows.push(buildRow(campaignRes, adSet, ad, name));
        }
      }
    }
    return rows;
  }

  // Concatenate row blocks for all names — FB creates one campaign per unique Campaign Name
  const allRows: Row[] = newCampaignNames.flatMap((name) => buildRowsForName(name));

  return generateTsv(allRows);
}
