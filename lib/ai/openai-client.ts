/**
 * Thin fetch wrapper for OpenAI's Responses API with strict JSON-schema structured output.
 * Server-side only — OPENAI_API_KEY never reaches the browser.
 */

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const TIMEOUT_MS = 30_000;

interface OpenAiContentPart {
  type: string;
  text?: string;
  refusal?: string;
}
interface OpenAiOutputItem {
  content?: OpenAiContentPart[];
}
interface OpenAiResponseBody {
  output?: OpenAiOutputItem[];
}

export class OpenAiRefusalError extends Error {
  constructor(reason: string) {
    super(`OpenAI refused: ${reason}`);
    this.name = 'OpenAiRefusalError';
  }
}

class RetryableOpenAiError extends Error {}

export interface CallOpenAiOptions {
  model: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
}

async function requestOnce<T>(options: CallOpenAiOptions): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI: OPENAI_API_KEY is not configured');

  let res: Response;
  try {
    res = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: options.model,
        input: [
          { role: 'system', content: options.system },
          { role: 'user', content: options.user },
        ],
        text: {
          format: { type: 'json_schema', name: options.schemaName, schema: options.schema, strict: true },
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new RetryableOpenAiError(`OpenAI: request failed — ${err instanceof Error ? err.message : String(err)}`);
  }

  if (res.status === 429 || res.status >= 500) {
    throw new RetryableOpenAiError(`OpenAI: HTTP ${res.status}`);
  }

  const json = (await res.json().catch(() => null)) as OpenAiResponseBody | null;
  if (!res.ok || !json) {
    throw new Error(`OpenAI: HTTP ${res.status}${json ? ` — ${JSON.stringify(json).slice(0, 300)}` : ''}`);
  }

  const output = json.output ?? [];
  for (const item of output) {
    for (const part of item.content ?? []) {
      if (part.type === 'refusal') {
        throw new OpenAiRefusalError(part.refusal ?? 'no reason given');
      }
    }
  }

  const textPart = output.flatMap((o) => o.content ?? []).find((p) => p.type === 'output_text' && p.text);
  if (!textPart?.text) throw new Error('OpenAI: no output_text in response');

  try {
    return JSON.parse(textPart.text) as T;
  } catch {
    throw new Error('OpenAI: failed to parse JSON output');
  }
}

/** One structured-output call, with a single retry on network errors / 429 / 5xx. Refusals are never retried. */
export async function callOpenAiJson<T>(options: CallOpenAiOptions): Promise<T> {
  try {
    return await requestOnce<T>(options);
  } catch (err) {
    if (err instanceof OpenAiRefusalError || !(err instanceof RetryableOpenAiError)) throw err;
    return requestOnce<T>(options);
  }
}
