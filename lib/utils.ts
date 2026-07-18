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

/** Two-letter initials from an email's local part (e.g. "jane.doe@x.com" → "JD") */
export function getInitials(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}
