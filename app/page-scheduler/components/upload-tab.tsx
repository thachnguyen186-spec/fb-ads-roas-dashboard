'use client';

import { useEffect, useMemo, useState } from 'react';
import { parseScheduleFile, type ParseResult } from '@/lib/page-scheduler/file-parse';
import { validateRows } from '@/lib/page-scheduler/row-validation';
import { DEFAULT_COUNTRIES } from '@/lib/page-scheduler/constants';
import type { PsPage, PsRowIssue } from '@/lib/page-scheduler/types';
import type { TabProps } from './page-scheduler-hub';
import UploadPreviewTable from './upload-preview-table';
import { BatchRequestError, createBatchRequest, finalizeRequest, uploadImages, type CreatedBatch } from './batch-upload-client';

type Phase = 'idle' | 'creating' | 'uploading' | 'finalizing' | 'done';
type PageRow = Pick<PsPage, 'page_id' | 'name' | 'tasks' | 'is_active'> & { is_owner: boolean };

export default function UploadTab({ onNavigate }: Partial<TabProps>) {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [pagesLoaded, setPagesLoaded] = useState(false);
  const [defaults, setDefaults] = useState<string[]>([...DEFAULT_COUNTRIES]);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [nowMs, setNowMs] = useState(0);
  const [serverIssues, setServerIssues] = useState<PsRowIssue[] | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [created, setCreated] = useState<CreatedBatch | null>(null);
  const [done, setDone] = useState('');

  useEffect(() => {
    fetch('/api/page-scheduler/pages?owner=me').then((r) => r.json()).then((d) => setPages(d.pages ?? [])).catch(() => setError('Failed to load your Pages')).finally(() => setPagesLoaded(true));
    fetch('/api/page-scheduler/settings').then((r) => r.json()).then((d) => d.default_countries && setDefaults(d.default_countries)).catch(() => {});
  }, []);

  const validation = useMemo(() => {
    if (!parsed?.ok) return null;
    return validateRows(parsed.rows, {
      pages: pages.filter((p) => p.is_owner && p.is_active), files: images.map((f) => ({ name: f.name, size: f.size, type: f.type })),
      defaultCountries: defaults, nowMs, extraColumns: parsed.extraColumns,
    });
  }, [parsed, pages, images, defaults, nowMs]);

  const issues = serverIssues ?? validation?.issues ?? [];
  const errorCount = issues.filter((i) => i.level === 'error').length;
  const warningCount = issues.length - errorCount;
  const busy = phase === 'creating' || phase === 'uploading' || phase === 'finalizing';

  function resetRun() {
    setServerIssues(null); setError(''); setCreated(null); setDone(''); setPhase('idle');
  }

  async function onDataFile(file: File | undefined) {
    if (!file) return;
    resetRun();
    setFileName(file.name);
    setNowMs(Date.now());
    setParsed(parseScheduleFile(await file.text(), file.name));
  }

  function onImages(list: FileList | null) {
    resetRun();
    setNowMs(Date.now());
    setImages(list ? Array.from(list) : []);
  }

  async function finish(batch: CreatedBatch) {
    setPhase('finalizing');
    setProgress('Verifying uploads…');
    const r = await finalizeRequest(batch.batch_id);
    setDone(`Batch created: ${r.queued} queued${r.waiting ? `, ${r.waiting} waiting for the Facebook window` : ''}. Open the Queue tab to push.`);
    setPhase('done');
  }

  async function submit() {
    if (!parsed?.ok || errorCount > 0) return;
    setError('');
    try {
      let batch = created;
      if (!batch) {
        setPhase('creating');
        setProgress('Validating on server…');
        batch = await createBatchRequest({ fileName, sourceType: parsed.sourceType, rows: parsed.rows, files: images, extraColumns: parsed.extraColumns });
        setCreated(batch);
      }
      if (batch.uploads.length) {
        setPhase('uploading');
        const failed = await uploadImages(batch.uploads, images, (d, t) => setProgress(`Uploading images ${d}/${t}…`));
        if (failed.length) throw new BatchRequestError(`Upload failed for: ${failed.join(', ')}. Click "Retry upload".`);
      }
      await finish(batch);
    } catch (err) {
      setPhase('idle');
      if (err instanceof BatchRequestError && err.issues.length) setServerIssues(err.issues);
      const extra = err instanceof BatchRequestError && err.missing.length ? ` (${err.missing.join('; ')})` : '';
      setError(`${err instanceof Error ? err.message : 'Upload failed'}${extra}`);
    }
  }

  const noPages = pagesLoaded && !pages.some((p) => p.is_owner && p.is_active);

  return (
    <div className="space-y-4">
      {noPages && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 space-y-1">
          <p className="font-medium">No Pages connected yet.</p>
          <p>
            Add a Facebook token in Settings first. For a System User token, assign the Pages to that system user in Business Settings
            (Users, System users, Add assets) with &quot;Create content&quot; access; for a personal user token, your profile needs a role on the Meta app.
          </p>
          {onNavigate && <button onClick={() => onNavigate('settings')} className="underline font-medium">Go to Settings</button>}
        </div>
      )}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-semibold text-slate-900">Upload schedule file</h2>
          <div className="text-sm space-x-3">
            <a href="/templates/page-scheduler-template.csv" download className="text-indigo-600 hover:underline">Download CSV template</a>
            <a href="/templates/page-scheduler-template.json" download className="text-indigo-600 hover:underline">JSON template</a>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Times without an offset are Bangkok time (UTC+7). Up to 35 days ahead; rows past Facebook&apos;s 29-day window wait and are pushed automatically.
          Spread posts across Pages and time: bulk-posting many items to one Page in a short burst can trigger Facebook spam blocks.
          Image column: empty, an https URL, or the name of a file you select below.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block text-sm text-slate-700 space-y-1">
            <span className="font-medium">CSV / JSON file</span>
            <input type="file" accept=".csv,.json,text/csv,application/json" disabled={busy} onChange={(e) => onDataFile(e.target.files?.[0])}
              className="block w-full text-sm text-slate-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-700" />
          </label>
          <label className="block text-sm text-slate-700 space-y-1">
            <span className="font-medium">Image files (optional, jpg/png/gif)</span>
            <input type="file" multiple accept=".jpg,.jpeg,.png,.gif,image/*" disabled={busy} onChange={(e) => onImages(e.target.files)}
              className="block w-full text-sm text-slate-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-700" />
            {images.length > 0 && <span className="text-xs text-slate-500">{images.length} file(s) selected</span>}
          </label>
        </div>
        {parsed && !parsed.ok && <p className="text-sm text-red-600">{parsed.error}</p>}
      </div>

      {parsed?.ok && validation && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="text-sm text-slate-700">
              <strong>{parsed.rows.length}</strong> rows ·{' '}
              <span className={errorCount ? 'text-red-600 font-medium' : 'text-emerald-600'}>{errorCount} errors</span> ·{' '}
              <span className="text-amber-600">{warningCount} warnings</span>
            </div>
            <button onClick={submit} disabled={busy || errorCount > 0 || phase === 'done'}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {busy ? progress : created ? 'Retry upload' : 'Create batch'}
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {done && <p className="text-sm text-emerald-600">{done}</p>}
          <UploadPreviewTable raw={parsed.rows} rows={validation.rows} issues={issues} />
        </div>
      )}
    </div>
  );
}
