/**
 * Parses an AppsFlyer "App performance by Ad ID" or "by Campaign ID" CSV export (client-side, no upload).
 *
 * Known columns: "Ad ID" or "Campaign ID", "App", "Revenue activity days appsflyer" (Ad ID exports
 * also carry "Total attributions appsflyer"). Columns are matched by name (case-insensitive) so extra
 * or reordered columns still work. The ID column decides the file's level: ad IDs are later mapped to
 * campaign + ad set via the ad platform; campaign IDs are used as-is (no ad set breakdown).
 * One file mixes every media source (Facebook, TikTok, others); each dashboard later keeps only
 * the rows it can tie to its own campaigns. Rows without a numeric ID (e.g. "None" for
 * unattributed traffic) are skipped and counted; IDs Excel turned into scientific notation are
 * counted separately so the user can re-export. Duplicate IDs are summed.
 */

import Papa from 'papaparse';

/** Which ID the export is broken down by. */
export type AppsflyerLevel = 'ad' | 'campaign';

export interface AppsflyerAdRow {
  /** Ad ID or Campaign ID, depending on the file's `level`. */
  id: string;
  app: string;
  /** "Revenue activity days" — the only revenue figure in the export. */
  revenue: number;
}

export interface AppsflyerParseResult {
  level: AppsflyerLevel;
  rows: AppsflyerAdRow[];
  totalRevenue: number;
  /** Rows dropped because the ID was missing or not numeric ("None" = unattributed). */
  skippedRows: number;
  skippedRevenue: number;
  /** Rows dropped because the ID was turned into scientific notation (file re-saved in Excel). */
  corruptedRows: number;
  corruptedRevenue: number;
}

/** "1.20213E+17": what Excel writes for a long numeric ID — the original digits are lost. */
const SCIENTIFIC_ID_RE = /^\d+(\.\d+)?e[+-]?\d+$/i;

/** User-facing warning for IDs lost to scientific notation. */
export function corruptedIdsMessage(count: number, level: AppsflyerLevel): string {
  return `${count} ${idLabel(level)}${count !== 1 ? 's were' : ' was'} corrupted (scientific notation) — re-export the CSV from AppsFlyer without opening it in Excel.`;
}

/** "Ad ID" / "Campaign ID" — the file's ID column, for messages. */
export function idLabel(level: AppsflyerLevel): string {
  return level === 'ad' ? 'Ad ID' : 'Campaign ID';
}

/** "ad" / "campaign" with a count, for summaries ("3 campaigns"). */
export function countLabel(count: number, level: AppsflyerLevel): string {
  return `${count} ${level}${count !== 1 ? 's' : ''}`;
}

function toNum(val: unknown): number {
  // Tolerate thousand separators and a currency sign from re-saved exports ("$1,234.56").
  const n = parseFloat(String(val ?? '').replace(/[,$\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function findColumn(fields: string[], test: (name: string) => boolean): string | undefined {
  return fields.find((f) => test(f.trim().toLowerCase()));
}

export function parseAppsflyerCsv(file: File): Promise<AppsflyerParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      // Must stay off: 16-18 digit ad IDs exceed Number.MAX_SAFE_INTEGER and would be rounded.
      dynamicTyping: false,
      skipEmptyLines: true,
      complete(results) {
        const fields = results.meta.fields ?? [];
        const adCol = findColumn(fields, (n) => n === 'ad id' || n === 'ad_id');
        const campaignCol = findColumn(fields, (n) => n === 'campaign id' || n === 'campaign_id');
        const idCol = adCol ?? campaignCol;
        const level: AppsflyerLevel = adCol ? 'ad' : 'campaign';
        const appCol = findColumn(fields, (n) => n === 'app' || n === 'app id' || n === 'app_id');
        const revCol = findColumn(fields, (n) => n.includes('revenue'));
        if (!idCol || !revCol) {
          reject(new Error('Not an AppsFlyer "by Ad ID" or "by Campaign ID" export: needs "Ad ID" or "Campaign ID" and a revenue column.'));
          return;
        }
        const byId = new Map<string, AppsflyerAdRow>();
        let totalRevenue = 0;
        let skippedRows = 0;
        let skippedRevenue = 0;
        let corruptedRows = 0;
        let corruptedRevenue = 0;
        for (const raw of results.data) {
          const id = String(raw[idCol] ?? '').trim();
          const revenue = toNum(raw[revCol]);
          totalRevenue += revenue;
          if (SCIENTIFIC_ID_RE.test(id)) { corruptedRows++; corruptedRevenue += revenue; continue; }
          if (!/^\d+$/.test(id)) { skippedRows++; skippedRevenue += revenue; continue; }
          const prev = byId.get(id);
          if (prev) prev.revenue += revenue;
          else byId.set(id, { id, app: appCol ? String(raw[appCol] ?? '').trim() : '', revenue });
        }
        resolve({ level, rows: [...byId.values()], totalRevenue, skippedRows, skippedRevenue, corruptedRows, corruptedRevenue });
      },
      error(err) {
        reject(new Error(`CSV parse error: ${err.message}`));
      },
    });
  });
}
