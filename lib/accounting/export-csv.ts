/**
 * Builds the accountant's CSV export — mirrors lib/spend-export.ts's manual string-builder
 * style (no CSV library dependency). Adds a formula-injection guard since owner_label is
 * user-editable free text that flows straight into the accountant's spreadsheet.
 */
import type { AccountingExportRow } from '@/lib/types';

const COLUMNS = ['Platform', 'Account ID', 'Account Name', 'Owner/Department', 'Campaign Name', 'Currency', 'Spend', 'Target'] as const;

/** Escapes a CSV cell: neutralizes a leading formula character, then quotes on comma/quote/newline. */
function csvCell(val: string): string {
  // A leading =, +, -, @, or tab would execute as a live formula when opened in Excel.
  const safe = /^[=+\-@\t]/.test(val) ? `'${val}` : val;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function formatSpend(spend: number, currency: string): string {
  return currency === 'VND' ? String(Math.round(spend)) : spend.toFixed(2);
}

function rowToLine(row: AccountingExportRow): string {
  return [
    row.platform === 'facebook' ? 'Facebook' : 'TikTok',
    row.account_id,
    row.account_name,
    row.owner_label,
    row.campaign_name,
    row.currency,
    formatSpend(row.spend, row.currency),
    row.target_label,
  ].map(csvCell).join(',');
}

/** Builds the CSV text (without BOM). No cross-currency total row — see UI per-currency subtotals. */
export function buildAccountingCsv(rows: AccountingExportRow[], rangeLabel: string): string {
  const lines: string[] = [];
  lines.push(csvCell(`Accounting Export — ${rangeLabel}`));
  lines.push('');
  lines.push(COLUMNS.join(','));
  for (const row of rows) lines.push(rowToLine(row));
  return lines.join('\r\n');
}

/** Triggers a browser download, UTF-8 BOM prefixed so Excel renders non-ASCII names correctly. */
export function downloadAccountingCsv(rows: AccountingExportRow[], rangeLabel: string, platform: string): void {
  const csv = buildAccountingCsv(rows, rangeLabel);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `accounting-export_${rangeLabel.replace(/[^\w-]+/g, '_')}_${platform}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
