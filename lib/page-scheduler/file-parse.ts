/**
 * CSV / JSON upload parser (browser + server safe). Produces untyped string rows; all semantic
 * checks live in row-validation.ts. Row numbers are 1-based data rows (header excluded).
 */

import Papa from 'papaparse';
import { MAX_ROWS_PER_UPLOAD } from './constants';
import type { PsSourceType } from './types';

export const TEMPLATE_COLUMNS = ['scheduled_at', 'page_id', 'message', 'image', 'countries'] as const;
const REQUIRED_COLUMNS = ['scheduled_at', 'page_id'] as const;

/** One file row as typed by the user (all strings). */
export interface RawRow {
  row: number;
  scheduled_at: string;
  page_id: string;
  message: string;
  image: string;
  countries: string;
}

export type ParseResult =
  | { ok: true; sourceType: PsSourceType; rows: RawRow[]; extraColumns: string[] }
  | { ok: false; error: string };

const stripBom = (s: string) => s.replace(/^\uFEFF/, '');

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).join('|');
  return String(v);
}

function toRows(records: Record<string, unknown>[], headers: string[]): ParseResult {
  const missing: string[] = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (!headers.includes('message') && !headers.includes('image')) missing.push('message');
  if (missing.length) return { ok: false, error: `Missing required column(s): ${missing.join(', ')}. Expected: ${TEMPLATE_COLUMNS.join(', ')}` };
  if (records.length === 0) return { ok: false, error: 'File has no data rows' };
  if (records.length > MAX_ROWS_PER_UPLOAD) {
    return { ok: false, error: `File has ${records.length} rows — max ${MAX_ROWS_PER_UPLOAD} per upload. Split it.` };
  }
  const rows = records.map((r, i): RawRow => ({
    row: i + 1,
    scheduled_at: cell(r.scheduled_at).trim(),
    page_id: cell(r.page_id).trim(),
    message: cell(r.message),
    image: cell(r.image).trim(),
    countries: cell(r.countries).trim(),
  }));
  const extraColumns = headers.filter((h) => !(TEMPLATE_COLUMNS as readonly string[]).includes(h));
  return { ok: true, sourceType: 'csv', rows, extraColumns };
}

function parseCsv(text: string): ParseResult {
  const res = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    // Off: 15-18 digit Page ids must stay strings (would be rounded as numbers).
    dynamicTyping: false,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => stripBom(h).trim().toLowerCase(),
  });
  const fatal = res.errors.find((e) => e.type === 'Quotes' || e.type === 'Delimiter');
  if (fatal && res.data.length === 0) return { ok: false, error: `CSV could not be read: ${fatal.message}` };
  const headers = (res.meta.fields ?? []).filter(Boolean);
  if (headers.length === 0) return { ok: false, error: 'CSV has no header row' };
  return toRows(res.data, headers);
}

function parseJson(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `JSON could not be read: ${err instanceof Error ? err.message : 'invalid JSON'}` };
  }
  if (!Array.isArray(data)) return { ok: false, error: 'JSON must be an array of row objects' };
  if (data.some((d) => d === null || typeof d !== 'object' || Array.isArray(d))) {
    return { ok: false, error: 'Every JSON array item must be an object with the template keys' };
  }
  // JSON numbers above 2^53 are silently rounded by JSON.parse (corrupts 16-17 digit Page ids).
  if (data.some((d) => Object.values(d as object).some((v) => typeof v === 'number' && Number.isInteger(v) && !Number.isSafeInteger(v)))) {
    return { ok: false, error: 'JSON contains an integer too large to be exact (Page ids must be quoted strings, e.g. "page_id": "102938475610293")' };
  }
  const records = data.map((d) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d as Record<string, unknown>)) out[k.trim().toLowerCase()] = v;
    return out;
  });
  const headers = [...new Set(records.flatMap((r) => Object.keys(r)))];
  const res = toRows(records, headers);
  return res.ok ? { ...res, sourceType: 'json' } : res;
}

/** Detects JSON vs CSV by file extension (fallback: first non-space char). */
export function parseScheduleFile(text: string, fileName: string): ParseResult {
  const clean = stripBom(text);
  const isJson = /\.json$/i.test(fileName) || (!/\.csv$/i.test(fileName) && /^\s*[[{]/.test(clean));
  return isJson ? parseJson(clean) : parseCsv(clean);
}
