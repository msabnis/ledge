/**
 * Display formatting helpers, ported verbatim from the original Tatsatiti Ledger.
 */

export function fmtGBP(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) n = 0;
  const neg = n < 0;
  const abs = Math.abs(n);
  const s = abs.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (neg ? "\u2212" : "") + "\u00A3" + s;
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) n = 0;
  return n.toLocaleString("en-GB");
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return "\u2014";
  return n.toFixed(1) + "%";
}
