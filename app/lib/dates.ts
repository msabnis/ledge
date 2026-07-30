/**
 * Date helpers, ported near-verbatim from the original Tatsatiti Ledger
 * (see /reference/tatsatiti-ledger-original.html). Framework-agnostic —
 * safe to import from both loaders/actions and browser components.
 */

export const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Parse a wide variety of date strings (Shopify ISO, "21 July 2026", etc.) into a JS Date. */
export function parseDateLoose(s: string | null | undefined): Date | null {
  if (!s) return null;
  s = String(s).trim();
  // Shopify style: 2026-07-23 13:09:30 +0100
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
  // "21 July 2026"
  m = s.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/);
  if (m) {
    const mi = MONTHS_LONG.findIndex((mo) =>
      mo.toLowerCase().startsWith(m![2].toLowerCase().slice(0, 3)),
    );
    if (mi >= 0) return new Date(parseInt(m[3]), mi, parseInt(m[1]));
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function monthKey(d: Date | null): string {
  if (!d) return "unknown";
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

export function monthLabel(key: string): string {
  if (key === "unknown") return "Undated";
  const [y, m] = key.split("-");
  return MONTHS_LONG[parseInt(m) - 1].slice(0, 3) + " " + y;
}

export function fmtDateShort(d: Date | string | null): string {
  if (!d) return "—";
  // Prisma gives real Date objects server-side, but useLoaderData JSON-serializes
  // loader data crossing to the browser, so by the time this runs in a component,
  // `d` is often an ISO string, not a Date instance. Coerce defensively.
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.getDate() + " " + MONTHS_LONG[date.getMonth()].slice(0, 3) + " " + date.getFullYear();
}

export function addMonths(date: Date, n: number): Date {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + n);
  return d;
}

export function lastDayOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

export type RangePreset = "month" | "quarter" | "fy" | "custom" | "all";

export interface RangeState {
  preset: RangePreset;
  from?: string | Date | null;
  to?: string | Date | null;
}

export interface ResolvedRange {
  preset: RangePreset;
  from: Date | null;
  to: Date | null;
}

/** Turn a preset ("month" | "quarter" | "fy" | "custom" | "all") into concrete from/to dates.
 *  "fy" = UK tax year (6 April to 5 April). */
export function resolveRange(rangeState: RangeState): ResolvedRange {
  const now = new Date();
  if (rangeState.preset === "month") {
    return { preset: "month", from: new Date(now.getFullYear(), now.getMonth(), 1), to: lastDayOfMonth(now) };
  }
  if (rangeState.preset === "quarter") {
    return { preset: "quarter", from: addDays(now, -90), to: now };
  }
  if (rangeState.preset === "fy") {
    const apr6ThisYear = new Date(now.getFullYear(), 3, 6);
    let from: Date, to: Date;
    if (now >= apr6ThisYear) {
      from = apr6ThisYear;
      to = new Date(now.getFullYear() + 1, 3, 5);
    } else {
      from = new Date(now.getFullYear() - 1, 3, 6);
      to = new Date(now.getFullYear(), 3, 5);
    }
    return { preset: "fy", from, to };
  }
  if (rangeState.preset === "custom") {
    return {
      preset: "custom",
      from: rangeState.from ? new Date(rangeState.from) : null,
      to: rangeState.to ? new Date(rangeState.to) : null,
    };
  }
  return { preset: "all", from: null, to: null };
}

export function inRange(date: Date | null, range: ResolvedRange): boolean {
  if (range.preset === "all") return true;
  if (!date) return false;
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}
