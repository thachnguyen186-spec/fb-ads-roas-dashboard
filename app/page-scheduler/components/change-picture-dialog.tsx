'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const MAX_BYTES = 4 * 1024 * 1024;
const PNG_MAX_BYTES = 1024 * 1024;
const BUCKET = 'page-scheduler-media';

interface Props {
  pageId: string;
  pageName: string;
  onClose: () => void;
  onDone: (pictureUrl: string) => void;
}

async function post(pageId: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/page-scheduler/pages/${pageId}/picture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Request failed');
  return data;
}

function validate(file: File): string {
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') return 'Use a JPEG or PNG image.';
  if (file.size > MAX_BYTES) return 'Image must be 4 MB or smaller.';
  if (file.type === 'image/png' && file.size > PNG_MAX_BYTES) return 'PNG must be 1 MB or smaller — use JPEG for larger images.';
  return '';
}

export default function ChangePictureDialog({ pageId, pageName, onClose, onDone }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pick(f: File | undefined) {
    setPreview('');
    setFile(null);
    if (!f) return;
    const problem = validate(f);
    setError(problem);
    if (!problem) setFile(f);
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const { path, token } = await post(pageId, { action: 'sign', size: file.size, type: file.type });
      const { error: upErr } = await createClient().storage.from(BUCKET).uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      const { picture_url } = await post(pageId, { action: 'apply', path });
      onDone(picture_url ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to change picture');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl p-6 w-full max-w-md space-y-4">
        <h3 className="font-semibold text-slate-900">Change profile picture</h3>
        <p className="text-sm text-slate-600">
          This replaces the picture of <span className="font-medium">{pageName}</span> ({pageId}) on Facebook.
        </p>
        <input
          type="file"
          accept="image/jpeg,image/png"
          disabled={busy}
          onChange={(e) => pick(e.target.files?.[0])}
          className="block w-full text-sm text-slate-600"
        />
        <p className="text-xs text-slate-400">JPEG up to 4 MB, PNG up to 1 MB. Square images work best.</p>
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Preview" className="w-24 h-24 rounded-full object-cover border border-slate-200" />
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!file || busy}
            className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white disabled:opacity-50"
          >
            {busy ? 'Applying…' : 'Confirm & apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
