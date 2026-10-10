/** ISO-3166 alpha-2 country codes accepted for Page post geo targeting + the tier-1 preset. */

import { DEFAULT_COUNTRIES } from './constants';

const ISO2 =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG ' +
  'UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW';

export const ISO2_CODES: ReadonlySet<string> = new Set(ISO2.split(' '));

/** Tier-1 preset (same list the DB default uses). */
export const TIER1_COUNTRIES: readonly string[] = DEFAULT_COUNTRIES;

export const MAX_DEFAULT_COUNTRIES = 25;

/**
 * Normalises (trim + uppercase + dedupe) and validates a list of country codes.
 * Returns the clean list or an error message.
 */
export function parseCountryList(input: unknown): { ok: true; countries: string[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'countries must be an array' };
  const clean = [...new Set(input.map((c) => (typeof c === 'string' ? c.trim().toUpperCase() : '')))];
  if (clean.length < 1 || clean.length > MAX_DEFAULT_COUNTRIES) {
    return { ok: false, error: `Provide 1-${MAX_DEFAULT_COUNTRIES} country codes` };
  }
  const bad = clean.filter((c) => !ISO2_CODES.has(c));
  if (bad.length) return { ok: false, error: `Invalid country code(s): ${bad.map((b) => b || '(empty)').join(', ')}` };
  return { ok: true, countries: clean };
}
