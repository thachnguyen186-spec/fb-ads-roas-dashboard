'use client';

/** Drop zone for an AppsFlyer "App performance by Ad ID" CSV. Parses in the browser (nothing is
 * uploaded or stored) and hands the parsed ad rows to the parent. Shared by FB and TikTok dashboards. */

import { useRef, useState } from 'react';
import { corruptedIdsMessage, parseAppsflyerCsv, type AppsflyerParseResult } from '@/lib/appsflyer/appsflyer-csv-parser';
import { formatUsd } from '@/lib/utils';

interface Props {
  onReady: (result: AppsflyerParseResult | null) => void;
  disabled?: boolean;
}

export default function AppsflyerCsvUpload({ onReady, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [summary, setSummary] = useState<AppsflyerParseResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');

  async function handleFile(f: File) {
    setError('');
    setParsing(true);
    try {
      const result = await parseAppsflyerCsv(f);
      if (result.rows.length === 0) {
        throw new Error(result.corruptedRows > 0
          ? corruptedIdsMessage(result.corruptedRows)
          : 'No ads with a numeric Ad ID found in this file.');
      }
      setFileName(f.name);
      setSummary(result);
      onReady(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read the AppsFlyer CSV');
      setFileName('');
      setSummary(null);
      onReady(null);
    } finally {
      setParsing(false);
      if (inputRef.current) inputRef.current.value = ''; // allow re-picking the same file after a new export
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && !disabled) handleFile(f);
  }

  return (
    <div className="space-y-2">
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg px-4 py-5 text-center transition-colors ${
          disabled
            ? 'border-slate-200 bg-slate-50 cursor-not-allowed'
            : summary
            ? 'border-emerald-400 bg-emerald-50 cursor-pointer'
            : 'border-slate-300 hover:border-indigo-400 cursor-pointer'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          disabled={disabled}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        {parsing ? (
          <p className="text-sm text-slate-500">Reading CSV…</p>
        ) : summary ? (
          <div>
            <p className="text-sm font-medium text-emerald-700 truncate">{fileName}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {summary.rows.length} ads · {formatUsd(summary.totalRevenue - summary.skippedRevenue - summary.corruptedRevenue)} revenue
              {summary.skippedRows > 0 && ` · ${summary.skippedRows} unattributed row${summary.skippedRows !== 1 ? 's' : ''} skipped`}
              {' · click to replace'}
            </p>
          </div>
        ) : (
          <div>
            <p className="text-sm text-slate-500">Drop AppsFlyer CSV here or click to browse</p>
            <p className="text-xs text-slate-400 mt-0.5">AppsFlyer → App performance by Ad ID export (.csv)</p>
          </div>
        )}
      </div>
      {summary && summary.corruptedRows > 0 && (
        <p className="text-xs text-amber-700">
          {corruptedIdsMessage(summary.corruptedRows)} Their {formatUsd(summary.corruptedRevenue)} revenue is not counted.
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
