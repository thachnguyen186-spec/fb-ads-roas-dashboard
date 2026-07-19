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

/** Maps TikTok's real budget_mode to BudgetTarget's generic budget_type union.
 * INFINITE (no fixed budget at this level) maps to 'cbo', same concept FB uses for ad sets
 * with no individual budget. */
export function toBudgetTargetType(budgetMode: string): 'daily' | 'lifetime' | 'cbo' | 'unknown' {
  if (budgetMode === TIKTOK_BUDGET_MODE_DAY) return 'daily';
  if (budgetMode === TIKTOK_BUDGET_MODE_TOTAL) return 'lifetime';
  if (budgetMode === TIKTOK_BUDGET_MODE_INFINITE) return 'cbo';
  return 'unknown';
}
