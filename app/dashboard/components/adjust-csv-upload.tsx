'use client';

import { useRef, useState } from 'react';
import { parseAppsFromCsv } from '@/lib/adjust/csv-parser';

interface Props {
  onReady: (file: File, appFilter: string | undefined) => void;
  disabled?: boolean;
}

export default function AdjustCsvUpload({ onReady, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [apps, setApps] = useState<string[]>([]);
  const [selectedApp, setSelectedApp] = useState<string>('');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');

  async function handleFile(f: File) {
    setError('');
    setParsing(true);
    try {
      const appList = await parseAppsFromCsv(f);
      setFile(f);
      setApps(appList);
      setSelectedApp('');
      onReady(f, undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV');
      setFile(null);
      setApps([]);
    } finally {
      setParsing(false);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f?.name.endsWith('.csv')) handleFile(f);
  }

  function handleAppChange(app: string) {
    setSelectedApp(app);
    if (file) onReady(file, app || undefined);
  }

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg px-4 py-6 text-center transition-colors ${
          disabled
            ? 'border-slate-700 bg-slate-800/30 cursor-not-allowed'
            : file
            ? 'border-emerald-700 bg-emerald-950/30 cursor-pointer'
            : 'border-slate-700 hover:border-indigo-500 cursor-pointer'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleInputChange}
          disabled={disabled}
        />
        {parsing ? (
          <p className="text-sm text-slate-400">Reading CSV…</p>
        ) : file ? (
          <div>
            <p className="text-sm font-medium text-emerald-400">{file.name}</p>
            <p className="text-xs text-slate-500 mt-0.5">Click to replace</p>
          </div>
        ) : (
          <div>
            <p className="text-sm text-slate-400">Drop Adjust CSV here or click to browse</p>
            <p className="text-xs text-slate-500 mt-0.5">.csv files only</p>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* App filter */}
      {apps.length > 1 && (
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Filter by app <span className="text-slate-500 font-normal">(optional)</span>
          </label>
          <select
            value={selectedApp}
            onChange={(e) => handleAppChange(e.target.value)}
            className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All apps</option>
            {apps.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
