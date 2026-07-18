/**
 * TikTok DAILY-mode budget minimums (research §4.4). LIFETIME mode has a dynamic minimum
 * (daily min × campaign duration) — not a flat constant, so callers skip this check for
 * LIFETIME and surface TikTok's own rejection message instead (Phase 4 Key Insights).
 */
export const MIN_DAILY_BUDGET_CAMPAIGN = 50;
export const MIN_DAILY_BUDGET_ADGROUP = 20;
