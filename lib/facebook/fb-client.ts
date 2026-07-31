/**
 * Thin fetch wrapper for Facebook Graph API v21.
 * Server-side only — token never sent to the browser.
 */

const FB_API_BASE = 'https://graph.facebook.com/v21.0';

/**
 * AFS Niche Testing-only Graph API version. Required for
 * `degrees_of_freedom_spec.creative_features_spec.standard_enhancements` (Advantage+ creative
 * opt-out), which needs v22.0+. Scoped exclusively to the new pages.ts/pixels.ts/ad-images.ts/
 * ad-creation.ts modules — every existing call site below defaults to FB_API_BASE (v21.0) and
 * is untouched by this addition.
 */
export const AFS_FB_API_BASE = 'https://graph.facebook.com/v22.0';

type FbError = { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string };

async function parseAndThrow(res: Response, json: unknown): Promise<never> {
  const parsed = json as { error?: FbError };
  const e = parsed.error;
  // Build a diagnostic message: "OAuthException | (#200) Permissions error [trace: abc]"
  const parts: string[] = [];
  if (e?.type) parts.push(e.type);
  parts.push(e?.message ?? `HTTP ${res.status}`);
  if (e?.fbtrace_id) parts.push(`[trace: ${e.fbtrace_id}]`);
  throw new Error(parts.join(' | '));
}

async function fbRequest(
  method: 'GET' | 'POST',
  path: string,
  urlParams: Record<string, string> = {},
  formParams: Record<string, string> | null = null,
  token: string,
  baseUrl: string = FB_API_BASE,
): Promise<unknown> {
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(urlParams)) {
    url.searchParams.set(k, v);
  }

  const options: RequestInit = { method };
  if (formParams) {
    // Send params as application/x-www-form-urlencoded in the POST body.
    // Required by some FB API endpoints (e.g. /copies) that reject URL-only params.
    const form = new URLSearchParams(formParams);
    options.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    options.body = form.toString();
  }

  const res = await fetch(url.toString(), options);
  const json = await res.json() as unknown;
  const parsed = json as { error?: FbError };

  if (!res.ok || parsed.error) {
    return parseAndThrow(res, json);
  }

  return json;
}

export function fbGet(path: string, params: Record<string, string>, token: string, baseUrl: string = FB_API_BASE) {
  return fbRequest('GET', path, params, null, token, baseUrl);
}

/**
 * FB Graph API mutations — sends params as URL query string.
 * Works for most campaign/adset PATCH-style operations.
 */
export function fbPatch(path: string, body: Record<string, unknown>, token: string, baseUrl: string = FB_API_BASE) {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) params[k] = String(v);
  return fbRequest('POST', path, params, null, token, baseUrl);
}

/**
 * FB Graph API POST with params in the request body (application/x-www-form-urlencoded).
 * Required for endpoints like /{campaign-id}/copies that reject URL-only params.
 */
export function fbPostForm(path: string, body: Record<string, unknown>, token: string, baseUrl: string = FB_API_BASE) {
  const form: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) form[k] = String(v);
  return fbRequest('POST', path, {}, form, token, baseUrl);
}

/**
 * FB Graph API multipart upload — used by the AFS `/adimages` ad-image upload (the documented
 * alternative to base64-in-urlencoded `bytes`; avoids base64 growth + percent-encoding).
 * Uses Node's native `FormData`/`Blob` globals. Response is a map keyed by each file's field
 * name (see ad-images.ts). Reuses `parseAndThrow` for consistent error formatting.
 */
export async function fbPostMultipart(
  path: string,
  files: Record<string, Blob>,
  fields: Record<string, string>,
  token: string,
  baseUrl: string = FB_API_BASE,
): Promise<unknown> {
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set('access_token', token);

  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const [name, blob] of Object.entries(files)) form.append(name, blob, name);

  const res = await fetch(url.toString(), { method: 'POST', body: form });
  const json = await res.json() as unknown;
  const parsed = json as { error?: FbError };

  if (!res.ok || parsed.error) {
    return parseAndThrow(res, json);
  }

  return json;
}
