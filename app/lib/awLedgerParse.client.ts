/**
 * Client-side parser for AW Dropship's bulk order/cost ledger export
 * (downloaded from the AW portal as .csv or .xlsx). This is the PRIMARY
 * cost ingestion path — see PLAN.md and prisma/schema.prisma's AwOrderCost
 * model for why.
 *
 * Uses SheetJS, which reads both formats through the same API, so one
 * parser handles whichever format a merchant happens to export. Runs
 * entirely in the browser, same pattern as pdfExtract.client.ts — nothing
 * is sent to the server until the merchant reviews the preview and hits Save.
 */
import * as XLSX from "xlsx";

export interface ParsedAwLedgerRow {
  reference: string;
  fulfillmentOrderGid: string | null;
  clientName: string | null;
  date: string | null;
  status: string | null;
  itemsCount: number | null;
  currency: string | null;
  goods: number | null;
  charges: number | null;
  chargesDetail: string | null;
  shipping: number | null;
  insurance: number | null;
  net: number | null;
  tax: number | null;
  total: number | null;
  paid: number | null;
}

// Maps our field names to the column header(s) AW's export uses. Kept as a list
// per field (not a single string) since AW could rename a column slightly
// between export versions — matched case-insensitively, trimmed.
const HEADER_MAP: Record<keyof ParsedAwLedgerRow, string[]> = {
  reference: ["Reference"],
  fulfillmentOrderGid: ["Platform order"],
  clientName: ["Client"],
  date: ["Date"],
  status: ["Status"],
  itemsCount: ["Items"],
  currency: ["Currency"],
  goods: ["Goods"],
  charges: ["Charges"],
  chargesDetail: ["Charges detail"],
  shipping: ["Shipping"],
  insurance: ["Insurance"],
  net: ["Net"],
  tax: ["Tax"],
  total: ["Total"],
  paid: ["Paid"],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase();
}

function buildHeaderIndex(rawHeaders: string[]): Partial<Record<keyof ParsedAwLedgerRow, string>> {
  const normalizedToRaw = new Map(rawHeaders.map((h) => [normalizeHeader(h), h]));
  const index: Partial<Record<keyof ParsedAwLedgerRow, string>> = {};
  for (const field of Object.keys(HEADER_MAP) as (keyof ParsedAwLedgerRow)[]) {
    for (const candidate of HEADER_MAP[field]) {
      const raw = normalizedToRaw.get(normalizeHeader(candidate));
      if (raw) {
        index[field] = raw;
        break;
      }
    }
  }
  return index;
}

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[£,]/g, ""));
  return isNaN(n) ? null : n;
}

function toStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export async function parseAwLedgerFile(file: File): Promise<ParsedAwLedgerRow[]> {
  const buf = await file.arrayBuffer();
  const isCsv = file.name.toLowerCase().endsWith(".csv");
  const workbook = XLSX.read(buf, { type: "array", cellDates: true, raw: isCsv ? undefined : false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("Couldn't find a sheet in this file.");

  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  if (!rows.length) throw new Error("No rows found — is this the right file?");

  const headerIndex = buildHeaderIndex(Object.keys(rows[0]));
  if (!headerIndex.reference) {
    throw new Error("Couldn't find a \u201cReference\u201d column — this doesn't look like an AW order ledger export.");
  }

  const parsed: ParsedAwLedgerRow[] = [];
  for (const row of rows) {
    const get = (field: keyof ParsedAwLedgerRow) => (headerIndex[field] ? row[headerIndex[field]!] : null);
    const reference = toStringOrNull(get("reference"));
    if (!reference) continue; // skip blank trailer rows some exports include

    parsed.push({
      reference,
      fulfillmentOrderGid: toStringOrNull(get("fulfillmentOrderGid")),
      clientName: toStringOrNull(get("clientName")),
      date: toStringOrNull(get("date")),
      status: toStringOrNull(get("status")),
      itemsCount: toNumberOrNull(get("itemsCount")),
      currency: toStringOrNull(get("currency")),
      goods: toNumberOrNull(get("goods")),
      charges: toNumberOrNull(get("charges")),
      chargesDetail: toStringOrNull(get("chargesDetail")),
      shipping: toNumberOrNull(get("shipping")),
      insurance: toNumberOrNull(get("insurance")),
      net: toNumberOrNull(get("net")),
      tax: toNumberOrNull(get("tax")),
      total: toNumberOrNull(get("total")),
      paid: toNumberOrNull(get("paid")),
    });
  }
  return parsed;
}
