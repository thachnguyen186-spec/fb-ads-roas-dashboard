/** Cross-row, advisory-only checks (never block a batch). Pure; browser + server safe. */

import { bangkokDay } from './schedule-time';
import type { PsRowIssue } from './types';

export interface WarnRow {
  row: number;
  page_id: string;
  ms: number;
  message: string;
}

const DAY_MS = 24 * 3600_000;
const SAME_PAGE_GAP_MS = 30 * 60_000;
const MAX_PER_PAGE_PER_DAY = 3;
const SPAM_PAGES = 3;

const warn = (row: number, field: string, message: string): PsRowIssue => ({ row, field, level: 'warning', message });

/** Same message on >= 3 distinct Pages within 24h -> spam risk. One warning per involved row. */
function spamWarnings(rows: WarnRow[]): PsRowIssue[] {
  const byMessage = new Map<string, WarnRow[]>();
  for (const r of rows) {
    const key = r.message.trim().toLowerCase();
    if (!key) continue;
    byMessage.set(key, [...(byMessage.get(key) ?? []), r]);
  }
  const flagged = new Set<number>();
  for (const group of byMessage.values()) {
    const sorted = [...group].sort((a, b) => a.ms - b.ms);
    for (let i = 0; i < sorted.length; i++) {
      const win = sorted.filter((r) => r.ms >= sorted[i].ms && r.ms - sorted[i].ms <= DAY_MS);
      if (new Set(win.map((r) => r.page_id)).size >= SPAM_PAGES) win.forEach((r) => flagged.add(r.row));
    }
  }
  return [...flagged].sort((a, b) => a - b).map((row) =>
    warn(row, 'message', 'Same message goes to 3+ Pages within 24h — Facebook may flag this as spam'));
}

export function crossRowWarnings(rows: WarnRow[]): PsRowIssue[] {
  const out: PsRowIssue[] = [...spamWarnings(rows)];
  const byPage = new Map<string, WarnRow[]>();
  for (const r of rows) byPage.set(r.page_id, [...(byPage.get(r.page_id) ?? []), r]);

  for (const list of byPage.values()) {
    const sorted = [...list].sort((a, b) => a.ms - b.ms);
    const perDay = new Map<string, number>();
    sorted.forEach((r, i) => {
      const day = bangkokDay(r.ms);
      const n = (perDay.get(day) ?? 0) + 1;
      perDay.set(day, n);
      if (n === MAX_PER_PAGE_PER_DAY + 1) {
        out.push(warn(r.row, 'scheduled_at', `More than ${MAX_PER_PAGE_PER_DAY} posts on this Page on ${day} — reach per post drops`));
      }
      if (i > 0 && r.ms - sorted[i - 1].ms < SAME_PAGE_GAP_MS) {
        out.push(warn(r.row, 'scheduled_at', `Less than 30 min after row ${sorted[i - 1].row} on the same Page`));
      }
    });
  }
  return out;
}
