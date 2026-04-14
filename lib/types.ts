// ─── User / Auth ───────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'leader' | 'staff';

/** User profile row stored in Supabase (extends auth.users) */
export interface UserProfile {
  id: string;
  fb_access_token: string | null;
  role: UserRole;
  created_at: string;
}

/** A user entry for admin management (profile + auth.users data joined) */
export interface ManagedUser {
  id: string;
  email: string;
  role: UserRole;
  created_at: string;
}

/** A staff member assigned to a leader, including their FB accounts */
export interface StaffMember {
  id: string;
  email: string;
  accounts: FbAdAccount[];
}

/** A Facebook Ad Account discovered via /me/adaccounts and saved per user */
export interface FbAdAccount {
  account_id: string;  // "act_XXXXX"
  name: string;
  is_selected: boolean;
  account_status: number | null; // 1=Active, 2=Disabled
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
