/**
 * Extracts "Cost per Install" from FB insights `cost_per_action_type`.
 * FB returns an array of { action_type, value } entries; different account
 * configs surface installs under different action_type keys, so we try the
 * common variants in priority order.
 */

export interface ActionCostEntry {
  action_type: string;
  // FB SDK variants return either a numeric string ("2.45") or a raw number.
  value: string | number;
}

const INSTALL_ACTION_TYPES = [
  'omni_app_install',     // FB-recommended aggregated install event
  'mobile_app_install',   // Classic MAI event
  'app_install',          // Generic fallback
] as const;

/**
 * Returns CPI in the currency FB reported (USD for USD accounts, VND for VND
 * accounts — caller converts to USD via vndRate). null = no install data.
 *
 * Priority: commits to the first action_type present in the response. A zero
 * or unparseable value on the highest-priority key returns null rather than
 * falling through to lower-priority keys, which might reflect a different
 * attribution window and mislead the user.
 */
export function extractCpi(entries: ActionCostEntry[] | undefined): number | null {
  if (!entries || entries.length === 0) return null;
  for (const type of INSTALL_ACTION_TYPES) {
    const hit = entries.find((e) => e.action_type === type);
    if (!hit) continue;
    const n = typeof hit.value === 'number' ? hit.value : parseFloat(hit.value);
    // Commit to this action_type even if n is 0 — don't leak a lower-priority
    // type's value. Only bail to null on unparseable input.
    return isNaN(n) ? null : n;
  }
  return null;
}
