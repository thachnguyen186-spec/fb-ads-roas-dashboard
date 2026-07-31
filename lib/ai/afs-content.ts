/**
 * Two OpenAI structured-output calls per topic: call A fills the 5 style templates, call B
 * writes ad copy + targeting. Both share the content-safety framing (informational/curiosity
 * tone, never a direct-address diagnosis, no cure/outcome/guarantee claims, no before/after or
 * personal-attribute implications) — it applies to the on-image headline and the FB body copy.
 */
import { callOpenAiJson, OpenAiRefusalError } from './openai-client';
import { GLOBAL_RULES, type StyleFill } from './image-prompt-templates';
import type { AfsStyleKey } from '@/lib/types';

export { OpenAiRefusalError };

const SAFETY_FRAMING =
  'Write in an informational, curiosity-driven third-person tone (e.g. "many people don\'t know…", ' +
  '"here\'s what experts say about…"). Never use direct-address diagnosis language ("your condition", ' +
  '"you have..."). Never claim a cure, a guaranteed outcome, or a specific result. Never imply a ' +
  'before/after transformation or any personal attribute about the reader (age, weight, appearance, ' +
  'financial status, etc.). This applies to both the on-image headline and any ad body copy.';

const STYLE_HINTS: Record<AfsStyleKey, string> = {
  notes_app: 'notes_app: looks like a phone notes-app screenshot, casual personal-discovery tone.',
  retro_pixel: 'retro_pixel: old-school computer dialog window with warm pixel-art corner illustrations.',
  editorial: 'editorial: muted warm illustrated scene, like a magazine feature-article thumbnail.',
  craft_paper: 'craft_paper: handwritten marker text on aged kraft paper with hand-drawn doodles.',
  bold_type: 'bold_type: massive bold typography on a solid warm color block, minimal.',
};

const styleFillSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    topic_visual_element: { type: 'string' },
    topic_scene: { type: 'string' },
    color: { type: 'string' },
  },
  required: ['headline', 'topic_visual_element', 'topic_scene', 'color'],
  additionalProperties: false,
};

const CALL_A_SCHEMA = {
  type: 'object',
  properties: {
    notes_app: styleFillSchema,
    retro_pixel: styleFillSchema,
    editorial: styleFillSchema,
    craft_paper: styleFillSchema,
    bold_type: styleFillSchema,
  },
  required: ['notes_app', 'retro_pixel', 'editorial', 'craft_paper', 'bold_type'],
  additionalProperties: false,
};

const CALL_B_SCHEMA = {
  type: 'object',
  properties: {
    primary_text: { type: 'string' },
    ad_headline: { type: 'string' },
    countries: { type: 'array', items: { type: 'string' } },
  },
  required: ['primary_text', 'ad_headline', 'countries'],
  additionalProperties: false,
};

type StyleFillMap = Record<AfsStyleKey, StyleFill>;
interface CopyResult { primary_text: string; ad_headline: string; countries: string[] }

export interface TopicContentResult {
  styles: StyleFillMap;
  copy: CopyResult;
}

async function generateStyleFills(model: string, topicText: string, correction?: string): Promise<StyleFillMap> {
  const user = [
    `Topic: "${topicText}".`,
    'For EACH of the 5 ad styles below, write a headline and supporting fill values for a text-heavy Facebook image ad. Follow the global rules exactly.',
    GLOBAL_RULES,
    Object.values(STYLE_HINTS).map((h) => `- ${h}`).join('\n'),
    correction ? `Correction needed: ${correction}` : '',
  ].filter(Boolean).join('\n\n');

  return callOpenAiJson<StyleFillMap>({
    model,
    system: `You write ad creative fill values for a Facebook image-ad generator. ${SAFETY_FRAMING}`,
    user,
    schemaName: 'style_fills',
    schema: CALL_A_SCHEMA,
  });
}

async function generateCopy(model: string, topicText: string, correction?: string): Promise<CopyResult> {
  const user = [
    `Topic: "${topicText}".`,
    'Write Facebook ad body copy (primary_text: 2-4 short sentences), a link headline (ad_headline: ' +
      '5-12 words, must name the topic explicitly), and the ISO-3166-1 alpha-2 country codes this ad ' +
      'should target (infer from context; default to ["US"] if unclear).',
    correction ? `Correction needed: ${correction}` : '',
  ].filter(Boolean).join('\n\n');

  return callOpenAiJson<CopyResult>({
    model,
    system: `You write Facebook ad copy. ${SAFETY_FRAMING}`,
    user,
    schemaName: 'ad_copy',
    schema: CALL_B_SCHEMA,
  });
}

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'your', 'about', 'into', 'over', 'without']);

function topicKeywords(topicText: string): string[] {
  return Array.from(new Set(
    topicText.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
  ));
}

function validateHeadline(headline: string, keywords: string[]): string | null {
  const wordCount = headline.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < 5 || wordCount > 12) {
    return `Headline "${headline}" has ${wordCount} words — must be 5-12 words.`;
  }
  if (keywords.length > 0) {
    const lower = headline.toLowerCase();
    if (!keywords.some((k) => lower.includes(k))) {
      return `Headline "${headline}" does not name the topic explicitly.`;
    }
  }
  return null;
}

function firstStyleHeadlineIssue(styles: StyleFillMap, keywords: string[]): string | null {
  for (const key of Object.keys(styles) as AfsStyleKey[]) {
    const issue = validateHeadline(styles[key].headline, keywords);
    if (issue) return `[${key}] ${issue}`;
  }
  return null;
}

// Reasonably complete ISO-3166-1 alpha-2 allowlist for FB `targeting.geo_locations.countries`.
const ISO_ALPHA2 = new Set(
  ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS ' +
    'BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE ' +
    'EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM ' +
    'HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC ' +
    'LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA ' +
    'NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
    'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO ' +
    'TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' '),
);

function validateCountries(countries: string[]): { valid: string[]; dropped: string[] } {
  const valid: string[] = [];
  const dropped: string[] = [];
  for (const raw of countries) {
    const code = raw.trim().toUpperCase();
    if (ISO_ALPHA2.has(code)) valid.push(code);
    else dropped.push(raw);
  }
  return { valid: valid.length ? valid : ['US'], dropped };
}

/**
 * Runs both OpenAI calls in parallel, validates headlines + countries, and retries once
 * (corrective message) on validation failure before failing the topic outright.
 */
export async function generateTopicContent(topicText: string): Promise<TopicContentResult> {
  const model = process.env.OPENAI_MODEL || 'gpt-5.4-nano';
  const keywords = topicKeywords(topicText);

  const [initialStyles, initialCopy] = await Promise.all([
    generateStyleFills(model, topicText),
    generateCopy(model, topicText),
  ]);

  let styles = initialStyles;
  let styleIssue = firstStyleHeadlineIssue(styles, keywords);
  if (styleIssue) {
    styles = await generateStyleFills(model, topicText, styleIssue);
    styleIssue = firstStyleHeadlineIssue(styles, keywords);
    if (styleIssue) throw new Error(`Topic generation failed: ${styleIssue}`);
  }

  let copy = initialCopy;
  let copyIssue = validateHeadline(copy.ad_headline, keywords);
  if (copyIssue) {
    copy = await generateCopy(model, topicText, copyIssue);
    copyIssue = validateHeadline(copy.ad_headline, keywords);
    if (copyIssue) throw new Error(`Topic generation failed: ${copyIssue}`);
  }

  const { valid: countries, dropped } = validateCountries(copy.countries);
  if (dropped.length) console.warn(`afs-content: dropped unknown country codes [${dropped.join(', ')}]`);

  return { styles, copy: { primary_text: copy.primary_text, ad_headline: copy.ad_headline, countries } };
}
