/**
 * Parses an AppsFlyer "App performance by Ad ID" CSV export (client-side, no upload).
 *
 * Known columns: "Ad ID", "App", "Revenue activity days appsflyer", "Total attributions appsflyer".
 * Columns are matched by name (case-insensitive) so extra or reordered columns still work.
 * One file mixes every media source (Facebook, TikTok, others); each dashboard later keeps only
 * the ads it can map to its own campaigns. Rows without a numeric Ad ID (e.g. "None" for
 * unattributed traffic) are skipped and counted; IDs Excel turned into scientific notation are
 * counted separately so the user can re-export. Duplicate Ad IDs are summed.
 */

import Papa from 'papaparse';

export interface AppsflyerAdRow {
  ad_id: string;
  app: string;
  /** "Revenue activity days" — the only revenue figure in the export. */
  revenue: number;
}

export interface AppsflyerParseResult {
  rows: AppsflyerAdRow[];
  totalRevenue: number;
  /** Rows dropped because the Ad ID was missing or not numeric ("None" = unattributed). */
  skippedRows: number;
  skippedRevenue: number;
  /** Rows dropped because the Ad ID was turned into scientific notation (file re-saved in Excel). */
  corruptedRows: number;
  corruptedRevenue: number;
}

/** "1.20213E+17": what Excel writes for a long numeric ID — the original digits are lost. */
const SCIENTIFIC_ID_RE = /^\d+(\.\d+)?e[+-]?\d+$/i;

/** User-facing warning for IDs lost to scientific notation. */
export function corruptedIdsMessage(count: number): string {
  return `${count} Ad ID${count !== 1 ? 's were' : ' was'} corrupted (scientific notation) — re-export the CSV from AppsFlyer without opening it in Excel.`;
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
        const appCol = findColumn(fields, (n) => n === 'app' || n === 'app id' || n === 'app_id');
        const revCol = findColumn(fields, (n) => n.includes('revenue'));
        if (!adCol || !revCol) {
          reject(new Error('Not an AppsFlyer "by Ad ID" export: needs "Ad ID" and a revenue column.'));
          return;
        }
        const byAd = new Map<string, AppsflyerAdRow>();
        let totalRevenue = 0;
        let skippedRows = 0;
        let skippedRevenue = 0;
        let corruptedRows = 0;
        let corruptedRevenue = 0;
        for (const raw of results.data) {
          const adId = String(raw[adCol] ?? '').trim();
          const revenue = toNum(raw[revCol]);
          totalRevenue += revenue;
          if (SCIENTIFIC_ID_RE.test(adId)) { corruptedRows++; corruptedRevenue += revenue; continue; }
          if (!/^\d+$/.test(adId)) { skippedRows++; skippedRevenue += revenue; continue; }
          const prev = byAd.get(adId);
          if (prev) prev.revenue += revenue;
          else byAd.set(adId, { ad_id: adId, app: appCol ? String(raw[appCol] ?? '').trim() : '', revenue });
        }
        resolve({ rows: [...byAd.values()], totalRevenue, skippedRows, skippedRevenue, corruptedRows, corruptedRevenue });
      },
      error(err) {
        reject(new Error(`CSV parse error: ${err.message}`));
      },
    });
  });
}
