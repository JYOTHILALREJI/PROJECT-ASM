// ---------------------------------------------------------------------------
// trade-utils.ts
// ---------------------------------------------------------------------------
// Pure trade-name helpers shared by server and client code.
// IMPORTANT: keep this module free of any `db` / server-only imports.
// ---------------------------------------------------------------------------

/** True when the employee's trade is "Helper" (case-insensitive). */
export function isHelperTrade(trade: string | null | undefined): boolean {
  return (trade ?? '').trim().toLowerCase() === 'helper';
}

/** Normalize a trade name for display/storage (trimmed). */
export function normalizeTrade(trade: string | null | undefined): string {
  const t = (trade ?? '').trim();
  return t !== '' ? t : 'Helper';
}
