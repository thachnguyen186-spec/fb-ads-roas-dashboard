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
  currency: string;              // e.g. 'USD', 'VND'
}

// ─── Campaigns / ROAS Dashboard ───────────────────────────────────────────────

/** Live FB campaign data from Marketing API v21 */
export interface CampaignRow {
  campaign_id: string;
  campaign_name: string;
  /** Which ad account this campaign belongs to */
  account_id: string;
  account_name: string;
  /** Account-level currency code (e.g. 'USD', 'VND') */
  currency: string;
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
  adset_id?: string;    // adgroup_id_network (present when Adjust exports ad set rows)
  adset_name?: string;  // adgroup_network
}

/** FB campaign merged with Adjust revenue data */
export interface MergedCampaign extends CampaignRow {
  adjust_revenue: number | null;
  /** Revenue / Spend; null if no Adjust match or spend === 0 */
  roas: number | null;
  has_adjust_data: boolean;
}

/** Ad Set fetched from FB API v21 with today's insights */
export interface AdSetRow {
  adset_id: string;
  adset_name: string;
  campaign_id: string;
  account_id: string;
  account_name: string;
  currency: string;
  status: string;
  effective_status: string;
  daily_budget: number | null;
  lifetime_budget: number | null;
  budget_remaining: number | null;
  /** 'cbo' = Campaign Budget Optimization (ad set has no individual budget) */
  budget_type: 'daily' | 'lifetime' | 'cbo';
  spend: number;
  impressions: number;
  clicks: number;
  cpm: number;
  cpc: number;
}

/** Ad Set merged with Adjust revenue data */
export interface MergedAdSet extends AdSetRow {
  adjust_revenue: number | null;
  roas: number | null;
  has_adjust_data: boolean;
}

/** Generic budget-bearing entity passed to BudgetModal — works for campaigns and ad sets */
export interface BudgetTarget {
  id: string;
  name: string;
  budget_type: 'daily' | 'lifetime' | 'cbo' | 'unknown';
  daily_budget: number | null;
  lifetime_budget: number | null;
  entity_type: 'campaign' | 'adset';
}
