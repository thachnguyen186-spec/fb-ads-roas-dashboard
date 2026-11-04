'use client';

/** Results-view strip: how much of the AppsFlyer file matched the loaded FB campaigns, mapping warnings/errors,
 * and a collapsible drop zone to replace the file (re-maps and re-merges in place). */

import { formatUsd } from '@/lib/utils';
import { corruptedIdsMessage, countLabel, type AppsflyerParseResult } from '@/lib/appsflyer/appsflyer-csv-parser';
import AppsflyerCsvUpload from './appsflyer-csv-upload';
import type { AppsflyerMatchSummary } from './use-appsflyer-revenue';

interface Props {
  summary: AppsflyerMatchSummary | null;
  warnings: string[];
  error: string;
  mapping: boolean;
  onReplace: (result: AppsflyerParseResult) => void;
}

export default function AppsflyerRevenueStatus({ summary, warnings, error, mapping, onReplace }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-3 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
        <span className="whitespace-nowrap pt-0.5">
          {mapping
            ? 'AppsFlyer: matching ads to campaigns…'
            : summary
            ? `AppsFlyer: ${summary.matchedAds} of ${countLabel(summary.totalAds, summary.level)} in the file matched to these campaigns · ${formatUsd(summary.matchedRevenue)}`
            : 'AppsFlyer: no file loaded'}
        </span>
        <details className="ml-auto">
          <summary className="cursor-pointer select-none text-emerald-700 hover:text-emerald-900 underline">Replace file</summary>
          <div className="mt-2 w-80">
            {/* A failed parse keeps the current revenue; the drop zone shows its own error. */}
            <AppsflyerCsvUpload onReady={(r) => { if (r) onReplace(r); }} disabled={mapping} />
          </div>
        </details>
      </div>
      {error && (
        <div className="px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          AppsFlyer mapping failed: {error}
        </div>
      )}
      {summary && summary.corruptedAds > 0 && (
        <div className="px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          {corruptedIdsMessage(summary.corruptedAds, summary.level)}
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 list-disc list-inside">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
    </div>
  );
}
