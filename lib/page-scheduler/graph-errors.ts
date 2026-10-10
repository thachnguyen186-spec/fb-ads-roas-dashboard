/**
 * Facebook Graph error classification + retry backoff for the Page Scheduler.
 * Pure functions — no I/O.
 */

import { FbApiError } from '@/lib/facebook/fb-client';
import type { FbErrorClass } from './types';

const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 80001]);
/** Clear "rejected, nothing created" throttle codes — the only ones safe to auto-requeue a PUSH on. */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 341, 613, 80001]);
const AUTH_CODES = new Set([190, 102]);

/** Classify by FB `code` / `error_subcode`. Accepts FbApiError or a bare {code, subcode}. */
export function classifyFbError(err: unknown): FbErrorClass {
  const e = err as { code?: unknown; subcode?: unknown; httpStatus?: unknown } | null;
  const code = typeof e?.code === 'number' ? e.code : undefined;
  const subcode = typeof e?.subcode === 'number' ? e.subcode : undefined;

  if (code !== undefined) {
    if (TRANSIENT_CODES.has(code)) return 'transient';
    if (AUTH_CODES.has(code)) return 'auth';
    if (code === 368) return 'blocked';
    if (code === 10 || (code >= 200 && code <= 299)) return 'permission';
    if (code === 100) return subcode === 33 ? 'not_found' : 'invalid';
    return 'unknown';
  }
  // No FB code: a bare 5xx / network-style failure is worth retrying.
  if (err instanceof FbApiError && err.httpStatus >= 500) return 'transient';
  if (typeof e?.httpStatus === 'number' && e.httpStatus >= 500) return 'transient';
  return 'unknown';
}

/** True when Graph explicitly throttled the request (code in RATE_LIMIT_CODES). */
export function isRateLimitError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'number' && RATE_LIMIT_CODES.has(code);
}

/** Retry delay: 60s x 2^(attempt-1), capped at 15 minutes. attempt is 1-based. */
export function backoffMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(60_000 * 2 ** (n - 1), 15 * 60_000);
}
