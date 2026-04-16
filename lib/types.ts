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
  /** FB application_id from promoted_object (null for non-app campaigns) */
  app_id: string | null;
  /** Resolved app name from FB API (null if no app or lookup failed) */
  app_name: string | null;
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
  /** CTR (all) as percentage, e.g. 3.25 means 3.25% — fetched directly from FB insights */
  ctr: number;
}

/** Row from Adjust CSV after filtering + aggregation */
export interface AdjustRow {
  campaign_id: string;   // campaign_id_network column
  campaign_name: string; // campaign_network column
  app: string;
  /** Sum of cohort_all_revenue for this campaign — used for D0 ROAS */
  revenue: number;
  /** Sum of all_revenue for this campaign — used for %Profit and Profit */
  all_revenue: number;
  adset_id?: string;    // adgroup_id_network (present when Adjust exports ad set rows)
  adset_name?: string;  // adgroup_network
}

/** FB campaign merged with Adjust revenue data */
export interface MergedCampaign extends CampaignRow {
  /** cohort_all_revenue — used for D0 ROAS display */
  adjust_revenue: number | null;
  /** all_revenue — used for %Profit and Profit calculations */
  adjust_all_revenue: number | null;
  /** cohort_all_revenue / Spend; null if no Adjust match or spend === 0 */
  roas: number | null;
  /** (all_revenue - Spend) / all_revenue * 100; null when no Adjust data or all_revenue === 0 */
  profit_pct: number | null;
  /** all_revenue - Spend in USD; null when no Adjust data */
  profit: number | null;
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
  /** CTR (all) as percentage, e.g. 3.25 means 3.25% — fetched directly from FB insights */
  ctr: number;
}

/** Ad Set merged with Adjust revenue data */
export interface MergedAdSet extends AdSetRow {
  /** cohort_all_revenue — used for D0 ROAS display */
  adjust_revenue: number | null;
  /** all_revenue — used for %Profit and Profit calculations */
  adjust_all_revenue: number | null;
  /** cohort_all_revenue / Spend; null if no Adjust match or spend === 0 */
  roas: number | null;
  /** (all_revenue - Spend) / all_revenue * 100; null when no Adjust data or all_revenue === 0 */
  profit_pct: number | null;
  /** all_revenue - Spend in USD; null when no Adjust data */
  profit: number | null;
  has_adjust_data: boolean;
}

// ─── Snapshots ────────────────────────────────────────────────────────────────

/** Campaign record stored inside a snapshot */
export interface SnapshotRow {
  campaign_id: string;
  campaign_name: string;
  /** Saved at snapshot time — may be null on snapshots created before this field was added */
  spend: number | null;
  cpm: number | null;
  ctr: number | null;
  adjust_revenue: number | null;
  roas: number | null;
  profit_pct: number | null;
  profit: number | null;
}

/** AdSet record stored inside a snapshot */
export interface SnapshotAdSetRow {
  adset_id: string;
  campaign_id: string;
  adset_name: string;
  spend: number | null;
  cpm: number | null;
  ctr: number | null;
  adjust_revenue: number | null;
  roas: number | null;
  profit_pct: number | null;
  profit: number | null;
}

/** Full snapshot payload stored in the `snapshot_data` JSONB column */
export interface SnapshotData {
  campaigns: SnapshotRow[];
  adsets: SnapshotAdSetRow[];
}

/** Lightweight snapshot list entry (no data blob) */
export interface SnapshotMeta {
  id: string;
  name: string;
  created_at: string;
}

/** Generic budget-bearing entity passed to BudgetModal — works for campaigns and ad sets */
export interface BudgetTarget {
  id: string;
  name: string;
  budget_type: 'daily' | 'lifetime' | 'cbo' | 'unknown';
  /** Budget values are in USD (after VND conversion in merge layer) */
  daily_budget: number | null;
  lifetime_budget: number | null;
  entity_type: 'campaign' | 'adset';
  /** Account-level currency code — used to display/accept in original currency */
  currency: string;
  /** VND→USD rate used during merge — needed to convert display back to original */
  vndRate: number;
}
