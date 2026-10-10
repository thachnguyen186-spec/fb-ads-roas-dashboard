'use client';

import { useCallback, useRef, useState } from 'react';

const PARALLEL_LOOPS = 2;
const IDLE_WAIT_MS = 1500;

interface StepResponse {
  pushed: number;
  failed: number;
  requeued: number;
  waiting: number;
  remaining_queued: number;
  done: boolean;
  backoff_ms?: number;
  halt?: string;
  stuck?: { id: string }[];
  error?: string;
}

export interface PushTotals {
  pushed: number;
  failed: number;
  requeued: number;
  waiting: number;
  stuck: number;
}

const ZERO: PushTotals = { pushed: 0, failed: 0, requeued: 0, waiting: 0, stuck: 0 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Client-driven resumable push: calls the step endpoint repeatedly (2 parallel loops; the server's
 * SKIP LOCKED claim keeps rows unique) until the queue is drained, halted (368) or an error occurs.
 */
export function usePushLoop(batchId: string, onStep: () => void) {
  const [running, setRunning] = useState(false);
  const [totals, setTotals] = useState<PushTotals>(ZERO);
  const [backoffLeft, setBackoffLeft] = useState(0);
  const [halt, setHalt] = useState('');
  const [error, setError] = useState('');
  const [finished, setFinished] = useState(false);
  const stopRef = useRef(true);

  const runLoop = useCallback(async () => {
    while (!stopRef.current) {
      let res: StepResponse;
      try {
        const r = await fetch(`/api/page-scheduler/batches/${batchId}/push`, { method: 'POST' });
        res = (await r.json()) as StepResponse;
        if (!r.ok) throw new Error(res.error ?? `HTTP ${r.status}`);
      } catch (err) {
        if (!stopRef.current) setError(err instanceof Error ? err.message : 'Push request failed');
        stopRef.current = true;
        return;
      }
      setTotals((t) => ({
        pushed: t.pushed + res.pushed, failed: t.failed + res.failed, requeued: t.requeued + res.requeued,
        waiting: res.waiting, stuck: t.stuck + (res.stuck?.length ?? 0),
      }));
      onStep();
      if (res.halt) {
        setHalt(res.halt);
        stopRef.current = true;
        return;
      }
      if (res.done) {
        if (!stopRef.current) setFinished(true);
        stopRef.current = true;
        return;
      }
      if (res.backoff_ms) {
        for (let left = Math.ceil(res.backoff_ms / 1000); left > 0 && !stopRef.current; left--) {
          setBackoffLeft(left);
          await sleep(1000);
        }
        setBackoffLeft(0);
      } else if (res.pushed + res.failed + res.requeued === 0) {
        await sleep(IDLE_WAIT_MS);
      }
    }
  }, [batchId, onStep]);

  const start = useCallback(async () => {
    if (!stopRef.current) return;
    stopRef.current = false;
    setRunning(true);
    setHalt('');
    setError('');
    setFinished(false);
    setTotals(ZERO);
    await Promise.all(Array.from({ length: PARALLEL_LOOPS }, () => runLoop()));
    setBackoffLeft(0);
    setRunning(false);
    onStep();
  }, [runLoop, onStep]);

  const stop = useCallback(() => {
    stopRef.current = true;
  }, []);

  return { running, totals, backoffLeft, halt, error, finished, start, stop };
}
