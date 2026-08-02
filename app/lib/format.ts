/**
 * Display formatting helpers, ported verbatim from the original Tatsatiti Ledger.
 */

/**
 * Formats an amount in any ISO currency using Intl.NumberFormat — correct
 * symbol, decimal places, and grouping for whichever currency code is passed,
 * no per-currency logic to maintain ourselves. Falls back to GBP if no code
 * is given, since that's every amount in the app today.
 *
 * Prefer this over fmtGBP wherever the value being displayed has its own
 * `currency` field (Order, AwOrderCost) — using fmtGBP there would silently
 * mislabel a non-GBP amount once multi-currency orders exist. fmtGBP remains
 * fine for aggregate figures (Dashboard/P&L/VAT) that don't have a single
 * currency to attribute to a sum across many rows.
 */
export function fmtMoney(n: number | null | undefined, currencyCode?: string | null): string {
  if (n === null || n === undefined || isNaN(n)) n = 0;
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: currencyCode || "GBP" }).format(n);
  } catch {
    // Unrecognized/malformed currency code — fall back rather than throw on a display path.
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
  }
}

export function fmtGBP(n: number | null | undefined): string {
  return fmtMoney(n, "GBP");
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) n = 0;
  return n.toLocaleString("en-GB");
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return "\u2014";
  return n.toFixed(1) + "%";
}
