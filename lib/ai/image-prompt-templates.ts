/**
 * The fixed image-ad ruleset from `image_ad_prompt_generator.md` — templates transcribed
 * VERBATIM (see file lines 27, 37, 47, 57, 67). Never paraphrase these strings. The LLM only
 * ever supplies the bracketed fill values; the surrounding prompt text is code-resident so the
 * fixed rules (no logos, no photorealism, headline+CTA only, 1:1, warm palette) can't drift.
 */
import type { AfsStyleKey } from '@/lib/types';

/** Rules section, `image_ad_prompt_generator.md` lines 9-17 — appended to call A's system prompt. */
export const GLOBAL_RULES = `Rules (apply to ALL prompts):
- Headline must name the topic explicitly. Never generic. "Enlarged Prostate" not "Health Concern." "Solar Panel Jobs" not "New Career."
- Format: 1:1 square (1080×1080)
- Text on image: headline + "Learn More" CTA button only. No other text, no body copy, no subheadlines.
- No logos, no brand marks, no real brand names, no photos of real people.
- Headline length: 5–12 words max.
- The image must feel native/organic — like content, not like an ad.
- Warm, muted, or earthy palettes preferred. No neon. No corporate blue-and-white.`;

export interface StyleFill {
  headline: string;
  topic_visual_element: string;
  topic_scene: string;
  color: string;
}

interface StyleTemplateEntry {
  label: string;
  template: string;
  placeholders: (keyof StyleFill)[];
}

export const STYLE_TEMPLATES: Record<AfsStyleKey, StyleTemplateEntry> = {
  notes_app: {
    label: 'Style 1 — Notes App',
    placeholders: ['headline'],
    template: `A square 1:1 social media image designed to look like a screenshot of a phone's notes app on a white lined-paper background. At the top, a simple gray toolbar with a "Notes" label. The main area shows bold black serif text that reads: "[HEADLINE]". Below the text, a rounded blue button with white text reading "Learn More". Clean, minimal, no other elements. The feel is casual, personal, like someone jotted down a genuine discovery. No logos, no brand marks.`,
  },
  retro_pixel: {
    label: 'Style 2 — Retro Pixel Art / Old Computer Window',
    placeholders: ['headline', 'topic_visual_element'],
    template: `A square 1:1 social media image styled as a retro computer window or dialog box with a chunky title bar and rounded close/minimize buttons. The background inside the window is off-white or cream. Bold condensed black text centered in the window reads: "[HEADLINE]". Small warm-toned pixel-art illustrations related to [TOPIC VISUAL ELEMENT — e.g. "a house roof," "a pill bottle," "a tractor"] are placed in the corners or margins. At the bottom, a pixelated rectangular button reads "Learn More". The overall palette is warm: amber, dusty orange, cream, soft olive. Nostalgic, playful, content-native feel. No logos, no brand marks, no photographs.`,
  },
  editorial: {
    label: 'Style 3 — Editorial Illustration',
    placeholders: ['headline', 'topic_scene'],
    template: `A square 1:1 social media image with a stylized editorial illustration filling the background. The illustration depicts [TOPIC SCENE — e.g. "a person sitting at a kitchen table looking at paperwork," "a worker on a rooftop with solar panels," "an elderly person walking in a garden"]. The color palette is muted and warm: terracotta, sage green, dusty rose, soft gold, warm gray. Overlaid on the illustration in bold condensed uppercase sans-serif text (white or cream with a subtle shadow for readability): "[HEADLINE]". A small rounded button at the bottom reads "Learn More" in a contrasting warm tone. The overall feel is editorial, thoughtful, like a feature article thumbnail. No logos, no brand marks, no photorealism.`,
  },
  craft_paper: {
    label: 'Style 4 — Handwritten on Craft Paper',
    placeholders: ['headline', 'topic_visual_element'],
    template: `A square 1:1 social media image with a textured aged kraft paper or brown cardboard background. The headline is written in bold black hand-lettered style (thick brush or marker feel): "[HEADLINE]". Simple hand-drawn doodles related to [TOPIC VISUAL ELEMENT — e.g. "a small house sketch," "a stethoscope doodle," "a dollar sign"] appear near the edges or underline the text. At the bottom, a hand-drawn rounded rectangle with "Learn More" written inside in a casual script. The overall feel is authentic, personal, tactile — like a handmade sign or a page from someone's journal. Warm browns, black ink, maybe a single accent color (dusty red or deep teal). No logos, no brand marks, no photographs.`,
  },
  bold_type: {
    label: 'Style 5 — Bold Typography on Solid Color Block',
    placeholders: ['headline', 'color'],
    template: `A square 1:1 social media image with a clean solid background in [COLOR — e.g. "warm mustard yellow," "muted terracotta," "deep sage green"]. The entire frame is dominated by large bold sans-serif text in a contrasting color (white, cream, or black) that reads: "[HEADLINE]". The text is centered and fills at least 60% of the frame. A thin horizontal accent line or a second color block in a complementary warm tone adds subtle visual interest. At the bottom, a pill-shaped button in a contrasting color reads "Learn More". Extremely minimal — no illustrations, no photos, no decorative elements. The power is in the typography and color alone. No logos, no brand marks.`,
  },
};

const MARKER_PATTERNS: Record<keyof StyleFill, RegExp> = {
  headline: /\[HEADLINE\]/g,
  topic_visual_element: /\[TOPIC VISUAL ELEMENT[^\]]*\]/g,
  topic_scene: /\[TOPIC SCENE[^\]]*\]/g,
  color: /\[COLOR[^\]]*\]/g,
};

/** Substitutes the bracketed markers (including any inline "— e.g. ..." example text) with real fills. */
export function fillTemplate(styleKey: AfsStyleKey, fill: StyleFill): string {
  const entry = STYLE_TEMPLATES[styleKey];
  let result = entry.template;
  for (const [key, pattern] of Object.entries(MARKER_PATTERNS) as [keyof StyleFill, RegExp][]) {
    // Replacer function, not a string — a bare string 2nd arg treats "$&", "$$", "$1" etc. in the
    // LLM-produced fill value as special replacement patterns, silently corrupting the prompt.
    result = result.replace(pattern, () => fill[key]);
  }
  if (/\[[A-Z][A-Z ]*\]/.test(result)) {
    throw new Error(`fillTemplate: unresolved [MARKER] remains for style "${styleKey}"`);
  }
  return result;
}
