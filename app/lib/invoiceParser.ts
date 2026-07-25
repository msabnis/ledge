/**
 * AW Dropship supplier invoice parser, ported verbatim from the original
 * Tatsatiti Ledger (see /reference/tatsatiti-ledger-original.html, lines
 * ~478-544). Runs client-side against text already extracted from a PDF
 * (see pdfExtract.client.ts) or pasted directly by the merchant.
 *
 * NOTE: this parser is tuned to AW's exact UK invoice text layout. It has
 * only been validated against UK-warehouse invoices — Slovakia/Spain
 * invoice formats are unconfirmed (Stage 2, see PLAN.md Section 5a).
 * Treat parse failures as "unrecognized format", not silent data loss —
 * always show the merchant what was and wasn't parsed.
 */

export interface ParsedInvoiceLineItem {
  code: string;
  desc: string;
  price: number;
  qty: number;
  amount: number;
}

export interface ParsedInvoice {
  docNumber: string;
  type: "invoice" | "refund";
  date: string | null; // loose date string, e.g. "21 July 2026" — parse with parseDateLoose before persisting
  originalInvoice: string | null;
  paymentState: string | null;
  weight: string | null;
  deliveryCountry: string | null;
  totalNet: number | null;
  shipping: number | null;
  charges: number | null;
  vat: number | null;
  total: number | null;
  outsideScopeOfTax: boolean;
  lineItems: ParsedInvoiceLineItem[];
}

export function parseSupplierInvoiceText(text: string): ParsedInvoice[] {
  const chunks = text.split(/\n(?=Invoice inv-|Refund ref-)/g);
  const docs: string[] = [];
  for (const raw of chunks) {
    const c = raw.trim();
    if (/^Invoice inv-/.test(c) || /^Refund ref-/.test(c)) docs.push(raw);
  }

  const results: ParsedInvoice[] = [];
  for (const d of docs) {
    const isRefund = /^\s*Refund ref-/.test(d);
    let docNumber: string | null = null;
    let docDate: string | null = null;
    let originalInvoice: string | null = null;

    if (isRefund) {
      const m = d.match(/Refund (ref-[\w-]+) Refund Date:\s*(\d{1,2} \w+ \d{4})/);
      if (m) {
        docNumber = m[1];
        docDate = m[2];
      }
      const om = d.match(/Original invoice number:\s*(inv-[\w-]+)/);
      if (om) originalInvoice = om[1];
    } else {
      const m = d.match(/Invoice (inv-[\w-]+) Invoice date:\s*(\d{1,2} \w+ \d{4})/);
      if (m) {
        docNumber = m[1];
        docDate = m[2];
      }
    }
    if (!docNumber) continue; // skip unparseable chunk — surface this to the merchant in the UI

    const paymentStateM = d.match(/Payment State:\s*(\w+)/);
    const weightM = d.match(/Weight:\s*([\d.]+ ?k?g)/);
    const dm = d.match(/Delivery address:([\s\S]*?)Code Description Price Qty\.? Amount/);
    let deliveryCountry: string | null = null;
    if (dm) {
      const lines = dm[1].split("\n").map((l) => l.trim()).filter(Boolean);
      deliveryCountry = lines.length ? lines[lines.length - 1] : null;
    }

    const netM = d.match(/Total Net\s*\u00A3(-?[\d.]+)/);
    const totalM = d.match(/\nTotal\s*\u00A3(-?[\d.]+)/);
    const vatM = d.match(/Tax\s*\u00A3(-?[\d.]+)\s*\nVAT 20% \(rate:20%\)/);
    const outsideScope = /Outside the scope of Tax/.test(d);
    const shippingM = d.match(/\nShipping\s*\u00A3(-?[\d.]+)/);
    const chargesM = d.match(/\nCharges\s*\u00A3(-?[\d.]+)/);

    const items: ParsedInvoiceLineItem[] = [];
    const itemRe = /^([A-Za-z0-9\-]+)\s+(.+?)\s+\u00A3(-?[\d.]+)\s+(-?\d+)\s+\u00A3(-?[\d.]+)\s*$/gm;
    let im: RegExpExecArray | null;
    while ((im = itemRe.exec(d)) !== null) {
      const [, code, desc, price, qty, amount] = im;
      if (["Total", "Tax", "VAT"].indexOf(code) !== -1) continue;
      items.push({ code, desc: desc.trim(), price: parseFloat(price), qty: parseInt(qty, 10), amount: parseFloat(amount) });
    }

    results.push({
      docNumber,
      type: isRefund ? "refund" : "invoice",
      date: docDate,
      originalInvoice,
      paymentState: paymentStateM ? paymentStateM[1] : null,
      weight: weightM ? weightM[1] : null,
      deliveryCountry,
      totalNet: netM ? parseFloat(netM[1]) : null,
      shipping: shippingM ? parseFloat(shippingM[1]) : null,
      charges: chargesM ? parseFloat(chargesM[1]) : null,
      vat: vatM ? parseFloat(vatM[1]) : outsideScope ? 0 : null,
      total: totalM ? parseFloat(totalM[1]) : null,
      outsideScopeOfTax: outsideScope,
      lineItems: items,
    });
  }
  return results;
}

/** Codes on AW invoices that represent shipping/handling, not real products. */
export function isFulfillmentCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return /^Z\d+$/i.test(code) || code === "Hanging-AWD";
}
