/** Standard JSON error response helper */
export function errorResponse(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

/** Format a USD dollar amount for display */
export function formatUsd(amount: number | null): string {
  if (amount === null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

/** Format a large number with commas */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}
