import type { PageTotal } from '@/lib/page-scheduler/analytics-aggregate';

export default function AnalyticsPageTotals({ totals }: { totals: PageTotal[] }) {
  if (totals.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
            <th className="py-1.5 pr-3 font-medium">Page</th>
            <th className="pr-3 font-medium text-right">Posts</th>
            <th className="pr-3 font-medium text-right">Engagement</th>
            <th className="pr-3 font-medium text-right">Avg / post</th>
            <th className="pr-3 font-medium text-right">Views</th>
            <th className="font-medium text-right">Best post</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {totals.map((t) => (
            <tr key={`${t.page_id}`}>
              <td className="py-1.5 pr-3 text-slate-800">{t.page_name || t.page_id}</td>
              <td className="pr-3 text-right tabular-nums">{t.posts}</td>
              <td className="pr-3 text-right tabular-nums font-medium">{t.engagement.toLocaleString()}</td>
              <td className="pr-3 text-right tabular-nums">{t.avg_engagement}</td>
              <td className="pr-3 text-right tabular-nums">{t.views.toLocaleString()}</td>
              <td className="text-right tabular-nums">{t.best_engagement.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
