/** Pure parsing of Graph metric responses into a ps_posts patch (no I/O). */

import { METRIC_NAMES } from './constants';
import type { GraphBatchItem } from './types';

export const INSIGHT_METRICS: string[] = [METRIC_NAMES.views, METRIC_NAMES.uniqueViews, METRIC_NAMES.clicks];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export interface Engagement { reactions: number; comments: number; shares: number }

/** reactions.summary.total_count / comments.summary.total_count / shares.count (absent -> 0). */
export function parseEngagement(body: unknown): Engagement {
  const b = (body ?? {}) as {
    reactions?: { summary?: { total_count?: unknown } };
    comments?: { summary?: { total_count?: unknown } };
    shares?: { count?: unknown };
  };
  return {
    reactions: num(b.reactions?.summary?.total_count) ?? 0,
    comments: num(b.comments?.summary?.total_count) ?? 0,
    shares: num(b.shares?.count) ?? 0,
  };
}

/** `data[].values[0].value` keyed by metric name; non-numeric values are ignored. */
export function parseInsights(body: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return out;
  for (const m of data as { name?: unknown; values?: { value?: unknown }[] }[]) {
    const v = num(m?.values?.[0]?.value);
    if (typeof m?.name === 'string' && v !== null) out[m.name] = v;
  }
  return out;
}

export interface InsightOutcome { values: Record<string, number>; errors: string[] }

/** Merge several insight batch items (one combined, or one per metric) into values + errors. */
export function mergeInsightItems(items: GraphBatchItem[]): InsightOutcome {
  const values: Record<string, number> = {};
  const errors: string[] = [];
  for (const it of items) {
    if (it.ok) Object.assign(values, parseInsights(it.body));
    else errors.push(it.error?.message ?? `HTTP ${it.status}`);
  }
  return { values, errors };
}

export interface MetricsPatch {
  reactions: number; comments: number; shares: number;
  views: number | null; unique_views: number | null; clicks: number | null;
  metrics_error: string | null;
}

/** Counts always come from the node read; insight gaps only set `metrics_error`. */
export function buildMetricsPatch(eng: Engagement, insights: InsightOutcome): MetricsPatch {
  const missing = INSIGHT_METRICS.filter((m) => !(m in insights.values));
  let error: string | null = null;
  if (insights.errors.length) error = insights.errors[0];
  else if (missing.length === INSIGHT_METRICS.length) error = 'Insights returned no data';
  else if (missing.length > 0) error = `Insights missing: ${missing.join(', ')}`;
  return {
    ...eng,
    views: insights.values[METRIC_NAMES.views] ?? null,
    unique_views: insights.values[METRIC_NAMES.uniqueViews] ?? null,
    clicks: insights.values[METRIC_NAMES.clicks] ?? null,
    metrics_error: error ? error.slice(0, 300) : null,
  };
}
