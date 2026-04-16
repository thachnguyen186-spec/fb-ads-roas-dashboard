'use client';

import { useEffect, useState } from 'react';

interface Props {
  accountId: string;
  currency: string;
  initialValue: number | null;
  onSave: (accountId: string, value: number | null) => Promise<void>;
}

/**
 * Inline-editable threshold input for a single account row.
 * Saves on blur or Enter; reverts on Escape.
 * Empty value → null (disables alerting for this account).
 */
export default function ThresholdCell({ accountId, currency, initialValue, onSave }: Props) {
  const [value, setValue] = useState<string>(initialValue === null ? '' : String(initialValue));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Re-sync when parent reloads data (e.g. after refresh)
  useEffect(() => {
    setValue(initialValue === null ? '' : String(initialValue));
  }, [initialValue]);

  const commit = async () => {
    setError('');
    const trimmed = value.trim();
    const next: number | null = trimmed === '' ? null : Number(trimmed);
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      setError('Invalid number');
      return;
    }
    if (next === initialValue) return; // no-op
    setSaving(true);
    try {
      await onSave(accountId, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setValue(initialValue === null ? '' : String(initialValue));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col">
      <input
        type="text"
        inputMode="decimal"
        value={value}
        disabled={saving}
        placeholder={`— (${currency})`}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setValue(initialValue === null ? '' : String(initialValue));
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="w-32 px-2 py-1 border border-slate-200 rounded-md text-sm tabular-nums focus:border-indigo-400 focus:outline-none disabled:opacity-50"
      />
      {error && <span className="text-xs text-red-500 mt-1">{error}</span>}
    </div>
  );
}
