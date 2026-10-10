/**
 * Shared upload validator (browser preview + authoritative server re-run). Pure: no I/O, no
 * `@/` server imports. DB-only checks (existing slot duplicates) are layered on by batch-create.
 */

import { MAX_MESSAGE_CHARS, MAX_SCHEDULE_DAYS, MAX_UPLOAD_DAYS, UPLOAD_MIN_LEAD_MIN } from './constants';
import { ISO2_CODES, MAX_DEFAULT_COUNTRIES } from './country-codes';
import type { RawRow } from './file-parse';
import { crossRowWarnings } from './row-validation-warnings';
import { parseScheduleTime } from './schedule-time';
import { fileProblem, sanitizeFileName, type UploadFileInfo } from './upload-file-rules';
import type { PsImageKind, PsRowIssue } from './types';

export interface ValidationPage {
  page_id: string;
  name: string;
  tasks: string[];
}

export interface ValidationContext {
  /** Caller's ACTIVE pages only. */
  pages: ValidationPage[];
  /** Image files the user picked (browser) / declared (server). */
  files: UploadFileInfo[];
  defaultCountries: string[];
  nowMs: number;
  /** Non-template columns found in the file (warning only). */
  extraColumns?: string[];
}

/** One row after resolution. `ok=false` rows carry only what could be resolved. */
export interface ValidatedRow {
  row: number;
  ok: boolean;
  page_id: string;
  page_name: string;
  scheduled_at: string | null;
  ms: number | null;
  message: string;
  image_kind: PsImageKind;
  /** https URL (kind url) or SANITISED file name (kind upload). */
  image_ref: string | null;
  /** Resolved target countries; [] = no geo targeting (ALL). */
  countries: string[];
}

export interface ValidationResult {
  rows: ValidatedRow[];
  issues: PsRowIssue[];
  errorCount: number;
  warningCount: number;
}

const COUNTRY_SPLIT = /[|,;\s]+/;

export function resolveCountries(raw: string, defaults: string[]): { countries: string[]; error?: string } {
  const value = raw.trim();
  if (!value) return { countries: defaults };
  if (value.toUpperCase() === 'ALL') return { countries: [] };
  const codes = [...new Set(value.split(COUNTRY_SPLIT).filter(Boolean).map((c) => c.toUpperCase()))];
  if (codes.length > MAX_DEFAULT_COUNTRIES) return { countries: [], error: `Too many countries (${codes.length}) — max ${MAX_DEFAULT_COUNTRIES}, or use ALL` };
  const bad = codes.filter((c) => !ISO2_CODES.has(c));
  if (bad.length) return { countries: [], error: `Unknown country code(s): ${bad.join(', ')}` };
  return { countries: codes };
}

function isHttpUrl(v: string): boolean {
  return /^https?:\/\//i.test(v);
}

export function validateRows(raw: RawRow[], ctx: ValidationContext): ValidationResult {
  const issues: PsRowIssue[] = [];
  const add = (row: number, field: string, message: string, level: 'error' | 'warning' = 'error') =>
    issues.push({ row, field, level, message });

  // --- uploaded file manifest (row 0 = file level) ---
  const fileBySafe = new Map<string, UploadFileInfo>();
  for (const f of ctx.files) {
    const safe = sanitizeFileName(f.name);
    if (fileBySafe.has(safe)) add(0, 'image', `Two selected files map to the same name "${safe}" — rename one`);
    else fileBySafe.set(safe, f);
  }
  for (const col of ctx.extraColumns ?? []) add(0, col, `Unknown column "${col}" is ignored`, 'warning');

  const pageMap = new Map(ctx.pages.map((p) => [p.page_id, p]));
  const minMs = ctx.nowMs + UPLOAD_MIN_LEAD_MIN * 60_000;
  const maxMs = ctx.nowMs + MAX_UPLOAD_DAYS * 86_400_000;
  const windowMs = ctx.nowMs + MAX_SCHEDULE_DAYS * 86_400_000;
  const slotRows = new Map<string, number>();
  const referenced = new Set<string>();

  const rows = raw.map((r): ValidatedRow => {
    const before = issues.length;
    const err = (field: string, m: string) => add(r.row, field, m);

    // time
    const t = parseScheduleTime(r.scheduled_at);
    let ms: number | null = null;
    if (!t.ok) err('scheduled_at', t.error);
    else {
      ms = t.ms;
      if (ms < minMs) err('scheduled_at', `Must be at least ${UPLOAD_MIN_LEAD_MIN} minutes from now`);
      else if (ms > maxMs) err('scheduled_at', `More than ${MAX_UPLOAD_DAYS} days ahead — not allowed`);
      else if (ms > windowMs) {
        add(r.row, 'scheduled_at', `Beyond Facebook's ${MAX_SCHEDULE_DAYS}-day window: will wait, auto-pushed hourly once within the window`, 'warning');
      }
    }

    // page
    const page = pageMap.get(r.page_id);
    if (!r.page_id) err('page_id', 'page_id is required');
    else if (!/^\d+$/.test(r.page_id)) err('page_id', `"${r.page_id}" is not a numeric Page id (Excel may have turned it into scientific notation — format the column as text)`);
    else if (!page) err('page_id', 'Page not found among your active connected Pages (Settings > Pages)');
    else if (!page.tasks.includes('CREATE_CONTENT')) err('page_id', 'Your token has no CREATE_CONTENT task on this Page');

    // slot duplicate within file
    if (ms !== null && page) {
      const key = `${r.page_id}|${ms}`;
      const first = slotRows.get(key);
      if (first !== undefined) err('scheduled_at', `Same Page and time as row ${first}`);
      else slotRows.set(key, r.row);
    }

    // message / image
    const message = r.message.replace(/\r\n/g, '\n').trim();
    if (message.length > MAX_MESSAGE_CHARS) err('message', `Message is ${message.length} chars — max ${MAX_MESSAGE_CHARS}`);
    let kind: PsImageKind = 'none';
    let ref: string | null = null;
    if (r.image) {
      if (isHttpUrl(r.image)) {
        let ok = false;
        try { ok = new URL(r.image).protocol === 'https:'; } catch { /* invalid */ }
        if (ok) { kind = 'url'; ref = r.image; } else err('image', 'Image URL must be a valid https:// URL');
      } else {
        const safe = sanitizeFileName(r.image);
        const file = fileBySafe.get(safe);
        if (!file) err('image', `"${r.image}" is not a URL and no selected file has that name`);
        else {
          referenced.add(safe);
          const problem = fileProblem(safe, file.size);
          if (problem) err('image', `${r.image}: ${problem}`);
          else { kind = 'upload'; ref = safe; }
        }
      }
    }
    if (!message && !r.image) err('message', 'Row needs a message or an image');

    // countries
    const c = resolveCountries(r.countries, ctx.defaultCountries);
    if (c.error) err('countries', c.error);

    const ok = issues.slice(before).every((i) => i.level !== 'error');
    return {
      row: r.row, ok, page_id: r.page_id, page_name: page?.name ?? '', ms,
      scheduled_at: ms === null ? null : new Date(ms).toISOString(),
      message, image_kind: kind, image_ref: ref, countries: c.countries,
    };
  });

  for (const safe of fileBySafe.keys()) {
    if (!referenced.has(safe)) add(0, 'image', `Selected file "${safe}" is not referenced by any row`, 'warning');
  }
  issues.push(...crossRowWarnings(rows.filter((x) => x.ms !== null && x.page_id)
    .map((x) => ({ row: x.row, page_id: x.page_id, ms: x.ms as number, message: x.message }))));

  issues.sort((a, b) => a.row - b.row);
  return {
    rows, issues,
    errorCount: issues.filter((i) => i.level === 'error').length,
    warningCount: issues.filter((i) => i.level === 'warning').length,
  };
}
