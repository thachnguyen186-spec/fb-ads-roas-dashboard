/**
 * Pure decision: what to do with a row after a failed push. No I/O.
 */

import { backoffMs, classifyFbError, isRateLimitError } from './graph-errors';
import type { FbErrorClass } from './types';

export const MAX_PUSH_ATTEMPTS = 3;

export type FailureAction =
  | { action: 'requeue'; cls: FbErrorClass; backoffMs: number }
  | { action: 'fail'; cls: FbErrorClass; invalidateProfile: boolean; halt: boolean;
      /** Transient non-throttle failure (codes 1/2, bare 5xx): FB may have created the post. */
      uncertain: boolean };

/** `attempts` is the count AFTER the claim incremented it (1 on the first try). */
export function decideFailure(err: unknown, attempts: number): FailureAction {
  const cls = classifyFbError(err);
  // Only explicit rate-limit rejections are auto-requeued; other transient errors may have created the post.
  if (cls === 'transient' && isRateLimitError(err) && attempts < MAX_PUSH_ATTEMPTS) {
    return { action: 'requeue', cls, backoffMs: backoffMs(attempts) };
  }
  return { action: 'fail', cls, invalidateProfile: cls === 'auth', halt: cls === 'blocked',
    uncertain: cls === 'transient' && !isRateLimitError(err) };
}
