/**
 * Graph API batch helper (POST /?batch=[...]). `GET /?ids=` is removed on v26, so
 * multi-object reads go through here. Server-side only.
 */

import { fbPostForm, PAGE_SCHEDULER_FB_API_BASE } from '@/lib/facebook/fb-client';
import { GRAPH_BATCH_MAX } from './constants';
import type { GraphBatchItem, GraphBatchRequest } from './types';

/** Split into chunks of at most `size`. Exported for tests. */
export function chunk<T>(items: T[], size: number = GRAPH_BATCH_MAX): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function failed(message: string, status = 0): GraphBatchItem {
  return { ok: false, status, error: { message } };
}

/** Convert one raw batch response entry ({code, body: "<json string>"} or null) to an item. */
export function parseBatchEntry(raw: unknown): GraphBatchItem {
  if (!raw || typeof raw !== 'object') return failed('No response for batch item (timed out)');
  const { code, body } = raw as { code?: number; body?: unknown };
  const status = typeof code === 'number' ? code : 0;
  let parsed: unknown = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      return failed(`Unparseable batch item body (HTTP ${status})`, status);
    }
  }
  const fbErr = (parsed as { error?: { message?: string; code?: number; error_subcode?: number } } | null)?.error;
  if (status >= 200 && status < 300 && !fbErr) return { ok: true, status, body: parsed };
  return {
    ok: false,
    status,
    error: {
      message: fbErr?.message ?? `HTTP ${status}`,
      code: fbErr?.code,
      subcode: fbErr?.error_subcode,
    },
  };
}

/**
 * Run requests in chunks of 50. Result array aligns 1:1 with `reqs`. Never throws per item;
 * if a whole chunk request fails (network/auth), every item in that chunk gets the error.
 */
export async function graphBatch(token: string, reqs: GraphBatchRequest[]): Promise<GraphBatchItem[]> {
  const results: GraphBatchItem[] = [];
  for (const part of chunk(reqs)) {
    try {
      const res = await fbPostForm(
        '/',
        { batch: JSON.stringify(part), include_headers: 'false' },
        token,
        PAGE_SCHEDULER_FB_API_BASE,
      );
      const arr = Array.isArray(res) ? (res as unknown[]) : [];
      for (let i = 0; i < part.length; i++) results.push(parseBatchEntry(arr[i]));
    } catch (e) {
      const err = e as { message?: string; code?: number; subcode?: number; httpStatus?: number };
      const item: GraphBatchItem = {
        ok: false,
        status: err.httpStatus ?? 0,
        error: { message: err.message ?? 'Batch request failed', code: err.code, subcode: err.subcode },
      };
      for (let i = 0; i < part.length; i++) results.push(item);
    }
  }
  return results;
}
