/** Pure analytics helpers: sorting top posts and per-page totals (no I/O). */

export const SORT_KEYS = ['engagement', 'reactions', 'comments', 'shares', 'views', 'clicks'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface AnalyticsRow {
  id: string;
  user_id: string;
  page_id: string;
  page_name: string;
  message: string;
  published_at: string | null;
  permalink_url: string | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  clicks: number | null;
  engagement: number;
  metrics_at: string | null;
  metrics_error: string | null;
}

export interface PageTotal {
  page_id: string;
  page_name: string;
  posts: number;
  engagement: number;
  avg_engagement: number;
  views: number;
  best_post_id: string | null;
  best_engagement: number;
}

export const isSortKey = (v: string | null): v is SortKey => !!v && (SORT_KEYS as readonly string[]).includes(v);

/** Descending by key; null metrics sort last; ties broken by newest published_at. */
export function topPosts(rows: AnalyticsRow[], sort: SortKey, limit: number): AnalyticsRow[] {
  return [...rows]
    .sort((a, b) => {
      const av = a[sort], bv = b[sort];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av || (b.published_at ?? '').localeCompare(a.published_at ?? '');
    })
    .slice(0, limit);
}

export function pageTotals(rows: AnalyticsRow[]): PageTotal[] {
  const map = new Map<string, PageTotal>();
  for (const r of rows) {
    const key = `${r.user_id}|${r.page_id}`;
    let t = map.get(key);
    if (!t) {
      t = { page_id: r.page_id, page_name: r.page_name, posts: 0, engagement: 0, avg_engagement: 0, views: 0, best_post_id: null, best_engagement: -1 };
      map.set(key, t);
    }
    t.posts++;
    t.engagement += r.engagement;
    t.views += r.views ?? 0;
    if (r.engagement > t.best_engagement) { t.best_engagement = r.engagement; t.best_post_id = r.id; }
  }
  return [...map.values()]
    .map((t) => ({ ...t, avg_engagement: t.posts ? Math.round((t.engagement / t.posts) * 10) / 10 : 0, best_engagement: Math.max(0, t.best_engagement) }))
    .sort((a, b) => b.engagement - a.engagement);
}
