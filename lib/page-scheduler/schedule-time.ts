/**
 * Pure schedule-time helpers (browser + server safe — no server imports).
 * File times WITHOUT an offset are Asia/Bangkok (+07:00); explicit offset / Z is honoured.
 * No `Date` string guessing: only the two formats below are accepted.
 */

import { SCHEDULE_TZ_OFFSET } from './constants';

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
const OFFSET_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

export const TIME_FORMAT_HINT = 'Use "YYYY-MM-DD HH:mm" (Bangkok time) or ISO 8601 with offset, e.g. 2026-10-15T09:30:00+07:00';

export type ParsedTime = { ok: true; iso: string; ms: number } | { ok: false; error: string };

function inRange(y: number, mo: number, d: number, h: number, mi: number, s: number): boolean {
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || s > 59 || d < 1) return false;
  // Round-trip through UTC catches Feb 30 etc.
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

export function parseScheduleTime(raw: string): ParsedTime {
  const value = (raw ?? '').trim();
  if (!value) return { ok: false, error: 'scheduled_at is required' };

  const local = LOCAL_RE.exec(value);
  const withOffset = local ? null : OFFSET_RE.exec(value);
  const m = local ?? withOffset;
  if (!m) return { ok: false, error: `Unrecognised time "${value}". ${TIME_FORMAT_HINT}` };

  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number);
  if (!inRange(y, mo, d, h, mi, s)) return { ok: false, error: `Invalid date/time "${value}". ${TIME_FORMAT_HINT}` };

  let offset = SCHEDULE_TZ_OFFSET;
  if (withOffset) {
    const o = withOffset[7].toUpperCase();
    offset = o === 'Z' ? 'Z' : o.includes(':') ? o : `${o.slice(0, 3)}:${o.slice(3)}`;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  const ms = Date.parse(`${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}${offset}`);
  if (Number.isNaN(ms)) return { ok: false, error: `Invalid date/time "${value}". ${TIME_FORMAT_HINT}` };
  return { ok: true, iso: new Date(ms).toISOString(), ms };
}

/** Bangkok wall-clock "YYYY-MM-DD HH:mm" for an instant (ISO string or epoch ms). */
export function formatBangkok(input: string | number): string {
  const ms = typeof input === 'number' ? input : Date.parse(input);
  if (Number.isNaN(ms)) return '';
  return new Date(ms + 7 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
}

/** Bangkok calendar day "YYYY-MM-DD" for an epoch ms (for per-day counting). */
export function bangkokDay(ms: number): string {
  return formatBangkok(ms).slice(0, 10);
}
