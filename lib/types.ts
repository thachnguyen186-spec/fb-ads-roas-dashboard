// ─── User / Auth ───────────────────────────────────────────────────────────────

/** User profile row stored in Supabase (extends auth.users) */
export interface UserProfile {
  id: string;
  fb_access_token: string | null;
  fb_ad_account_id: string | null;
  created_at: string;
}

// ─── Campaigns / ROAS Dashboard ───────────────────────────────────────────────

/** Live FB campaign data from Marketing API v21 */
export interface CampaignRow {
  campaign_id: string;
  campaign_name: string;
  status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DELETED' | string;
  effective_status: string;
  /** Daily budget in USD (null if lifetime budget campaign) */
  daily_budget: number | null;
  /** Lifetime budget in USD (null if daily budget campaign) */
  lifetime_budget: number | null;
  budget_remaining: number | null;
  /** Which budget type is active */
  budget_type: 'daily' | 'lifetime' | 'unknown';
  /** Today's spend in USD (partial — FB insights delayed 6–48h) */
  spend: number;
  impressions: number;
  clicks: number;
  cpm: number;
  cpc: number;
}

/** Row from Adjust CSV after filtering + aggregation */
export interface AdjustRow {
  campaign_id: string;   // campaign_id_network column
  campaign_name: string; // campaign_network column
  app: string;
  /** Sum of cohort_all_revenue for this campaign (period revenue, not lifetime) */
  revenue: number;
}

/** FB campaign merged with Adjust revenue data */
export interface MergedCampaign extends CampaignRow {
  adjust_revenue: number | null;
  /** Revenue / Spend; null if no Adjust match or spend === 0 */
  roas: number | null;
  has_adjust_data: boolean;
}
