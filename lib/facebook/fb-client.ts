/**
 * Thin fetch wrapper for Facebook Graph API v21.
 * Server-side only — token never sent to the browser.
 */

const FB_API_BASE = 'https://graph.facebook.com/v21.0';

async function fbRequest(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  params: Record<string, string> = {},
  body: Record<string, unknown> | null = null,
  token: string,
): Promise<unknown> {
  const url = new URL(`${FB_API_BASE}${path}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const options: RequestInit = { method };
  if (body) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), options);
  const json = await res.json() as unknown;
  const parsed = json as { error?: { message?: string } };

  if (!res.ok || parsed.error) {
    const msg = parsed.error?.message ?? `FB API error ${res.status}`;
    throw new Error(msg);
  }

  return json;
}

export function fbGet(path: string, params: Record<string, string>, token: string) {
  return fbRequest('GET', path, params, null, token);
}

/**
 * FB Graph API mutations must use POST with params in the URL query string.
 * JSON bodies and PATCH method are not supported for campaign/adset updates.
 */
export function fbPatch(path: string, body: Record<string, unknown>, token: string) {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) params[k] = String(v);
  return fbRequest('POST', path, params, null, token);
}
