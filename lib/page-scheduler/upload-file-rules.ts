/** Pure image-file rules shared by browser preview and server (no server imports). */

import { IMAGE_EXTS, IMAGE_MAX_BYTES, PNG_MAX_BYTES } from './constants';

export interface UploadFileInfo {
  name: string;
  size: number;
  type?: string;
}

/** lowercase, unsafe chars -> `_`. Same output is used for matching and the storage key. */
export function sanitizeFileName(name: string): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  return base.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_');
}

export function fileExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

/** Error message when the file breaks FB limits / type rules, else null. */
export function fileProblem(name: string, size: number): string | null {
  const ext = fileExt(name);
  if (!(IMAGE_EXTS as readonly string[]).includes(ext)) return `unsupported type ".${ext}" — use ${IMAGE_EXTS.join(', ')}`;
  if (!Number.isFinite(size) || size <= 0) return 'file is empty';
  if (size > IMAGE_MAX_BYTES) return `file is ${(size / 1048576).toFixed(1)} MB — max ${IMAGE_MAX_BYTES / 1048576} MB`;
  if (ext === 'png' && size > PNG_MAX_BYTES) return `PNG is ${(size / 1048576).toFixed(1)} MB — max ${PNG_MAX_BYTES / 1048576} MB (use JPEG)`;
  return null;
}

export function contentTypeFor(name: string): string {
  switch (fileExt(name)) {
    case 'png': return 'image/png';
    case 'gif': return 'image/gif';
    default: return 'image/jpeg';
  }
}
