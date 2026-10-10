'use client';

import { useMemo, useState } from 'react';
import type { ValidatedRow } from '@/lib/page-scheduler/row-validation';
import type { RawRow } from '@/lib/page-scheduler/file-parse';
import { formatBangkok } from '@/lib/page-scheduler/schedule-time';
import type { PsRowIssue } from '@/lib/page-scheduler/types';

interface Props {
  raw: RawRow[];
  rows: ValidatedRow[];
  issues: PsRowIssue[];
}

const snippet = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);

export default function UploadPreviewTable({ raw, rows, issues }: Props) {
  const [onlyIssues, setOnlyIssues] = useState(false);
  const byRow = useMemo(() => {
    const m = new Map<number, PsRowIssue[]>();
    for (const i of issues) m.set(i.row, [...(m.get(i.row) ?? []), i]);
    return m;
  }, [issues]);
  const fileIssues = byRow.get(0) ?? [];
  const shown = onlyIssues ? rows.filter((r) => byRow.has(r.row)) : rows;

  return (
    <div className="space-y-2">
      {fileIssues.length > 0 && (
        <ul className="text-xs space-y-1">
          {fileIssues.map((i, k) => (
            <li key={k} className={i.level === 'error' ? 'text-red-600' : 'text-amber-600'}>{i.message}</li>
          ))}
        </ul>
      )}
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
        Only rows with errors or warnings
      </label>
      <div className="border border-slate-200 rounded-lg overflow-auto max-h-[28rem]">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 sticky top-0">
            <tr>
              {['#', 'Time (Bangkok)', 'Page', 'Message', 'Image', 'Countries', 'Issues'].map((h) => (
                <th key={h} className="text-left font-medium px-2 py-2 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((r) => {
              const rowIssues = byRow.get(r.row) ?? [];
              const hasErr = rowIssues.some((i) => i.level === 'error');
              const src = raw[r.row - 1];
              return (
                <tr key={r.row} className={hasErr ? 'bg-red-50' : rowIssues.length ? 'bg-amber-50' : ''}>
                  <td className="px-2 py-1.5 text-slate-500">{r.row}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap font-mono">{r.ms !== null ? formatBangkok(r.ms) : src?.scheduled_at}</td>
                  <td className="px-2 py-1.5">{r.page_name || <span className="font-mono text-slate-500">{r.page_id}</span>}</td>
                  <td className="px-2 py-1.5 max-w-[16rem] whitespace-pre-wrap break-words">{snippet(r.message)}</td>
                  <td className="px-2 py-1.5 max-w-[10rem] truncate" title={src?.image}>
                    {r.image_kind === 'none' ? (src?.image ? <span className="text-red-600">{src.image}</span> : '—') : `${r.image_kind === 'url' ? 'URL' : 'file'}: ${r.image_ref}`}
                  </td>
                  <td className="px-2 py-1.5">{r.countries.length === 0 ? 'ALL' : r.countries.length > 4 ? `${r.countries.length} countries` : r.countries.join(', ')}</td>
                  <td className="px-2 py-1.5 space-y-0.5">
                    {rowIssues.map((i, k) => (
                      <div key={k} className={i.level === 'error' ? 'text-red-600' : 'text-amber-600'}>{i.message}</div>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
