/**
 * Thin fetch wrapper for TikTok Business API v1.3.
 * Server-side only — token never sent to the browser.
 */

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

interface TiktokEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

async function parseEnvelope<T>(res: Response): Promise<T> {
  const text = await res.text();
  let json: TiktokEnvelope<T>;
  try {
    json = JSON.parse(text) as TiktokEnvelope<T>;
  } catch {
    throw new Error(`TikTok API returned non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (json.code !== 0) {
    throw new Error(json.message ?? `TikTok API error ${json.code}`);
  }
  return json.data;
}

/** token = '' for the unauthenticated oauth2/access_token/ exchange+refresh endpoint (auth is via app_id/secret in the body). */
export async function tiktokGet<T = unknown>(
  path: string,
  params: Record<string, string>,
  token: string,
): Promise<T> {
  const url = new URL(`${TIKTOK_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  return parseEnvelope<T>(res);
}

/** token = '' for the unauthenticated oauth2/access_token/ exchange+refresh endpoint (auth is via app_id/secret in the body). */
export async function tiktokPost<T = unknown>(
  path: string,
  body: Record<string, unknown>,
  token: string,
): Promise<T> {
  const res = await fetch(`${TIKTOK_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  return parseEnvelope<T>(res);
}
