/**
 * Lists ad pixels under an ad account (`GET /act_{id}/adspixels`). A pixel is optional signal
 * for a LINK_CLICKS traffic campaign (the destination is a third-party AFS page we own no
 * events on), so failures here are non-fatal: caught and surfaced as a warning string rather
 * than thrown, so the rest of the fb-assets response still succeeds.
 */

import { fbGet, AFS_FB_API_BASE } from './fb-client';
import type { FbPixel } from '@/lib/types';

interface RawPixel {
  id: string;
  name: string;
}

interface RawPixelResponse {
  data: RawPixel[];
  paging?: { cursors?: { after?: string }; next?: string };
}

export async function fetchPixels(
  token: string,
  accountId: string,
): Promise<{ pixels: FbPixel[]; warning?: string }> {
  const pixels: FbPixel[] = [];
  let after: string | undefined;

  try {
    do {
      const params: Record<string, string> = { fields: 'id,name', limit: '100' };
      if (after) params.after = after;

      const page = await fbGet(`/${accountId}/adspixels`, params, token, AFS_FB_API_BASE) as RawPixelResponse;
      for (const raw of page.data ?? []) {
        pixels.push({ id: raw.id, name: raw.name });
      }

      after = page.paging?.cursors?.after;
      if (!page.paging?.next) break;
    } while (after);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { pixels: [], warning: `Pixels unavailable for this account (pixel is optional): ${msg}` };
  }

  return { pixels };
}
