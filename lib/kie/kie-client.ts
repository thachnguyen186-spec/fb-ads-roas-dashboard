/**
 * Thin fetch wrapper for Kie AI's marketplace job API (generic `jobs/createTask` /
 * `jobs/recordInfo` pattern), targeting the hosted GPT-Image-1 model.
 *
 * UNRESOLVED PRE-IMPLEMENTATION GATE (see Phase 04 Overview / Validation Session 1): the exact
 * `KIE_MODEL` id (`gpt-image/1.5-text-to-image` is the researched guess) and the `input` field
 * names (`aspect_ratio`/`quality` vs a `size`/`resolution` shape) are UNCONFIRMED against a live
 * Kie account — WebFetch could not render Kie's JS-rendered docs SPA, and no live API key is
 * configured in this environment. If the marketplace path turns out not to support GPT-Image-1,
 * this file's shape must change to target the dedicated `POST /api/v1/gpt4o-image/generate`
 * endpoint instead (different fields: `size`, `nVariants`; different response wrapper:
 * `{code,msg,data}` + `successFlag` instead of `state`). Confirm this — a go/no-go check — before
 * relying on this file in production; the `input` shape below is the best documented guess.
 */

const KIE_API_BASE = 'https://api.kie.ai/api/v1';
const REQUEST_TIMEOUT_MS = 30_000;

interface KieEnvelope<T> {
  code?: number;
  msg?: string;
  data?: T;
}

export interface KieTaskResult {
  state: string;
  resultUrls: string[];
  failMsg: string | null;
}

function requireApiKey(): string {
  const apiKey = process.env.KIE_API_KEY;
  if (!apiKey) throw new Error('Kie: KIE_API_KEY is not configured');
  return apiKey;
}

/** Submits one image-generation job. Returns Kie's taskId — no callback URL is ever sent (reconcile-on-poll is the sole completion path). */
export async function createTask(prompt: string): Promise<string> {
  const apiKey = requireApiKey();
  const model = process.env.KIE_MODEL;
  if (!model) throw new Error('Kie: KIE_MODEL is not configured');

  const res = await fetch(`${KIE_API_BASE}/jobs/createTask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: { prompt, aspect_ratio: '1:1', quality: 'high' } }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (res.status === 429) throw new Error('Kie rate limit — retry shortly');

  const json = (await res.json().catch(() => null)) as KieEnvelope<{ taskId?: string }> | null;
  if (!res.ok || !json || json.code !== 200 || !json.data?.taskId) {
    throw new Error(`Kie: createTask failed — ${json?.msg ?? `HTTP ${res.status}`}`);
  }
  return json.data.taskId;
}

/** Polls a submitted task's result. Never call before a poll cycle — Kie result URLs are short-lived. */
export async function getTaskResult(taskId: string): Promise<KieTaskResult> {
  const apiKey = requireApiKey();

  const url = new URL(`${KIE_API_BASE}/jobs/recordInfo`);
  url.searchParams.set('taskId', taskId);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (res.status === 429) throw new Error('Kie rate limit — retry shortly');

  const json = (await res.json().catch(() => null)) as
    | KieEnvelope<{ state?: string; resultJson?: string; failMsg?: string }>
    | null;
  if (!res.ok || !json || json.code !== 200 || !json.data) {
    throw new Error(`Kie: recordInfo failed — ${json?.msg ?? `HTTP ${res.status}`}`);
  }

  const { state, resultJson, failMsg } = json.data;
  let resultUrls: string[] = [];
  if (resultJson) {
    try {
      const parsed = JSON.parse(resultJson) as { resultUrls?: string[] };
      resultUrls = Array.isArray(parsed.resultUrls) ? parsed.resultUrls : [];
    } catch {
      // Malformed resultJson is treated as no output — resolveCreative() will fail the row with a clear message.
    }
  }

  return { state: state ?? 'unknown', resultUrls, failMsg: failMsg ?? null };
}
