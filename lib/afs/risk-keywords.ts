/**
 * Employment/housing/credit-adjacent keyword heuristic backing the special_ad_category hard
 * blocker (Phase 06 Red Team Fix). A heuristic, not authoritative — real enforcement is Meta's ad
 * review — but a topic matching one of these with special_ad_category='NONE' must not publish
 * without an explicit human override, given the account-wide blast radius of miscategorization.
 * Shared between the client (review-publish-step.tsx, blocks the button) and the server
 * (publish route, the actual enforcement — the client check alone is bypassable via direct API
 * calls).
 */

export const RISK_KEYWORDS = [
  'job', 'jobs', 'career', 'careers', 'hiring', 'employ', 'employment',
  'housing', 'apartment', 'rent', 'rental', 'mortgage', 'loan', 'loans', 'credit', 'refinance', 'insurance',
];

export const SPECIAL_CATEGORY_OVERRIDE_PHRASE = 'I CONFIRM NO SPECIAL CATEGORY APPLIES';

export function matchesRiskKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return RISK_KEYWORDS.some((kw) => new RegExp(`\\b${kw}\\b`).test(lower));
}
