/**
 * TikTok DAILY-mode budget minimums (research §4.4). LIFETIME mode has a dynamic minimum
 * (daily min × campaign duration) — not a flat constant, so callers skip this check for
 * LIFETIME and surface TikTok's own rejection message instead (Phase 4 Key Insights).
 */
export const MIN_DAILY_BUDGET_CAMPAIGN = 50;
export const MIN_DAILY_BUDGET_ADGROUP = 20;

/**
 * TikTok's real budget_mode values — confirmed from a live /campaign/get/ response, which
 * returned 'BUDGET_MODE_DAY'/'BUDGET_MODE_TOTAL'/'BUDGET_MODE_INFINITE', not the bare
 * 'DAILY'/'LIFETIME' this integration originally assumed (that mismatch silently disabled the
 * DAILY-minimum check and mis-typed every budget as 'lifetime' in the budget-edit modal).
 */
export const TIKTOK_BUDGET_MODE_DAY = 'BUDGET_MODE_DAY';
export const TIKTOK_BUDGET_MODE_TOTAL = 'BUDGET_MODE_TOTAL';
export const TIKTOK_BUDGET_MODE_INFINITE = 'BUDGET_MODE_INFINITE';
/** Upgraded Smart+ campaigns report this (confirmed live via /smart_plus/campaign/get/) — a daily budget. */
export const TIKTOK_BUDGET_MODE_DYNAMIC_DAILY = 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET';

/** True for every per-day budget mode (standard daily and Smart+ dynamic daily). */
export function isDailyBudgetMode(budgetMode: string): boolean {
  return budgetMode === TIKTOK_BUDGET_MODE_DAY || budgetMode === TIKTOK_BUDGET_MODE_DYNAMIC_DAILY;
}

/** Maps TikTok's real budget_mode to BudgetTarget's generic budget_type union.
 * INFINITE (no fixed budget at this level) maps to 'cbo', same concept FB uses for ad sets
 * with no individual budget. */
export function toBudgetTargetType(budgetMode: string): 'daily' | 'lifetime' | 'cbo' | 'unknown' {
  if (isDailyBudgetMode(budgetMode)) return 'daily';
  if (budgetMode === TIKTOK_BUDGET_MODE_TOTAL) return 'lifetime';
  if (budgetMode === TIKTOK_BUDGET_MODE_INFINITE) return 'cbo';
  return 'unknown';
}
