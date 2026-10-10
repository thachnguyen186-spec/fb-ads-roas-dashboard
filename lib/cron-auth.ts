/**
 * Shared Vercel Cron auth: `Authorization: Bearer ${CRON_SECRET}` compared timing-safe.
 * Returns a Response on denial (caller `return`s it) or null when authorised.
 */

import { timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import { errorResponse } from '@/lib/utils';

export function verifyCronRequest(request: NextRequest): Response | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) return errorResponse('CRON_SECRET not configured', 500);
  const auth = request.headers.get('authorization') ?? '';
  // Timing-safe comparison prevents byte-by-byte oracle attacks on the secret
  const actualBuf = Buffer.from(auth);
  const wantBuf = Buffer.from(`Bearer ${expected}`);
  const valid = actualBuf.length === wantBuf.length && timingSafeEqual(actualBuf, wantBuf);
  return valid ? null : errorResponse('Forbidden', 403);
}
