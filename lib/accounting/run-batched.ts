import { chunk } from '@/lib/utils';
import type { AccountingExportRow } from '@/lib/types';

export const CONCURRENCY = 3;
const MAX_CONSECUTIVE_FAILS = 5;

export interface LegResult { rows: AccountingExportRow[]; warnings: string[]; partial: boolean }

/** Runs `worker` over `items` in batches of CONCURRENCY; aborts the leg after 5 consecutive failures. */
export async function runBatched<T>(items: T[], worker: (item: T) => Promise<void>, warnings: string[]): Promise<boolean> {
  let consecutiveFails = 0;
  for (const batch of chunk(items, CONCURRENCY)) {
    const results = await Promise.allSettled(batch.map(worker));
    for (const r of results) {
      if (r.status === 'rejected') {
        warnings.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
        consecutiveFails += 1;
      } else {
        consecutiveFails = 0;
      }
    }
    if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) return true; // leg aborted
  }
  return false;
}
