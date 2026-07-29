'use client';

import { useEffect, useState } from 'react';
import type { AccountOwnerEntry } from '@/lib/types';

type Field = 'owner_label' | 'department_label';

interface Props {
  onLabelChanged: (accountId: string, platform: 'facebook' | 'tiktok', field: Field, label: string) => void;
}

const inputCls = 'w-full px-2 py-1 text-sm border border-slate-200 rounded-md focus:border-indigo-400 focus:outline-none';

function LabelCell({ entry, field, onSaved }: { entry: AccountOwnerEntry; field: Field; onSaved: (label: string) => void }) {
  const initial = entry[field];
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setValue(initial); }, [initial]);

  async function commit() {
    setError('');
    if (value === initial) return;
    setSaving(true);
    try {
      const res = await fetch('/api/account-owners', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Only the edited field is sent — the sibling label (owner vs department) is left untouched server-side.
        body: JSON.stringify({ account_id: entry.account_id, platform: entry.platform, [field]: value }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Save failed');
      onSaved(typeof json[field] === 'string' ? json[field] : value.trim().replace(/\s+/g, ' '));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setValue(initial);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col">
      <input
        type="text"
        value={value}
        disabled={saving}
        placeholder="Unassigned"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setValue(initial); (e.target as HTMLInputElement).blur(); }
        }}
        className={inputCls}
      />
      {error && <span className="text-xs text-red-500 mt-0.5">{error}</span>}
    </div>
  );
}

export default function GroupingManager({ onLabelChanged }: Props) {
  const [accounts, setAccounts] = useState<AccountOwnerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/account-owners');
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Failed to load accounts');
        setAccounts(json.accounts ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load accounts');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p className="text-sm text-slate-400">Loading account groupings…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;

  function handleSaved(a: AccountOwnerEntry, field: Field, label: string) {
    setAccounts((prev) => prev.map((row) =>
      row.account_id === a.account_id && row.platform === a.platform ? { ...row, [field]: label } : row));
    onLabelChanged(a.account_id, a.platform, field, label);
  }

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
          <tr>
            <th className="text-left px-3 py-2">Platform</th>
            <th className="text-left px-3 py-2">Account</th>
            <th className="text-left px-3 py-2">Currency</th>
            <th className="text-left px-3 py-2">Owner</th>
            <th className="text-left px-3 py-2">Department</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {accounts.map((a) => (
            <tr key={`${a.platform}:${a.account_id}`}>
              <td className="px-3 py-2 text-slate-500">{a.platform === 'facebook' ? 'Facebook' : 'TikTok'}</td>
              <td className="px-3 py-2">
                <div className="font-medium text-slate-800">{a.account_name}</div>
                <div className="text-xs text-slate-400">{a.account_id}</div>
              </td>
              <td className="px-3 py-2 text-slate-500">{a.currency}</td>
              <td className="px-3 py-2 max-w-[10rem]">
                <LabelCell entry={a} field="owner_label" onSaved={(label) => handleSaved(a, 'owner_label', label)} />
              </td>
              <td className="px-3 py-2 max-w-[10rem]">
                <LabelCell entry={a} field="department_label" onSaved={(label) => handleSaved(a, 'department_label', label)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
