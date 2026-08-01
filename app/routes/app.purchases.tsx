import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Button,
  TextField,
  DataTable,
  Text,
  Badge,
  Banner,
  Divider,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { parseAwLedgerFile, type ParsedAwLedgerRow } from "../lib/awLedgerParse.client";
import { resolveFulfillmentOrderGid } from "../lib/fulfillmentResolve.server";
import { extractPdfText } from "../lib/pdfExtract.client";
import { parseSupplierInvoiceText, isFulfillmentCode, type ParsedInvoice } from "../lib/invoiceParser";
import { parseDateLoose, fmtDateShort } from "../lib/dates";
import { fmtGBP } from "../lib/format";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [awCosts, invoices] = await Promise.all([
    db.awOrderCost.findMany({ where: { shop }, orderBy: { date: "desc" }, take: 50 }),
    db.supplierInvoice.findMany({ where: { shop }, orderBy: { date: "desc" }, take: 50 }),
  ]);

  return { awCosts, invoices };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();

  // --- Primary: AW order ledger (CSV/xlsx) ---
  if (body.kind === "aw_ledger") {
    const rows: ParsedAwLedgerRow[] = body.rows;
    const saved: string[] = [];
    let linked = 0;

    for (const row of rows) {
      const existing = await db.awOrderCost.findUnique({
        where: { shop_reference: { shop, reference: row.reference } },
        select: { orderId: true },
      });
      // Don't re-spend an API call re-resolving a reference we've already linked.
      let orderId = existing?.orderId ?? null;
      if (!orderId && row.fulfillmentOrderGid) {
        orderId = await resolveFulfillmentOrderGid(admin, db, shop, row.fulfillmentOrderGid);
      }
      if (orderId) linked++;

      const date = row.date ? parseDateLoose(row.date) : null;
      const fields = {
        shop,
        reference: row.reference,
        fulfillmentOrderGid: row.fulfillmentOrderGid,
        orderId,
        clientName: row.clientName,
        date,
        status: row.status,
        itemsCount: row.itemsCount,
        currency: row.currency,
        goods: row.goods,
        charges: row.charges,
        chargesDetail: row.chargesDetail,
        shipping: row.shipping,
        insurance: row.insurance,
        net: row.net,
        tax: row.tax,
        total: row.total,
        paid: row.paid,
      };
      await db.awOrderCost.upsert({
        where: { shop_reference: { shop, reference: row.reference } },
        create: fields,
        update: fields,
      });
      saved.push(row.reference);
    }
    return { kind: "aw_ledger", saved, linked };
  }

  // --- Optional: AW invoice PDF / pasted text ---
  if (body.kind === "aw_invoice") {
    const docs: ParsedInvoice[] = body.docs;
    const saved: string[] = [];
    for (const doc of docs) {
      const date = doc.date ? parseDateLoose(doc.date) : null;
      const fields = {
        shop,
        docNumber: doc.docNumber,
        type: doc.type,
        date,
        originalInvoice: doc.originalInvoice,
        paymentState: doc.paymentState,
        deliveryCountry: doc.deliveryCountry,
        totalNet: doc.totalNet,
        shipping: doc.shipping,
        charges: doc.charges,
        vat: doc.vat,
        total: doc.total,
        outsideScopeOfTax: doc.outsideScopeOfTax,
      };
      const invoice = await db.supplierInvoice.upsert({
        where: { shop_docNumber: { shop, docNumber: doc.docNumber } },
        create: fields,
        update: fields,
      });
      await db.supplierInvoiceLineItem.deleteMany({ where: { invoiceId: invoice.id } });
      if (doc.lineItems.length) {
        await db.supplierInvoiceLineItem.createMany({
          data: doc.lineItems.map((li) => ({
            invoiceId: invoice.id,
            code: li.code,
            desc: li.desc,
            price: li.price,
            qty: li.qty,
            amount: li.amount,
          })),
        });
      }
      saved.push(invoice.docNumber);
    }
    return { kind: "aw_invoice", saved };
  }

  return { error: "Unknown submission kind" };
};

export default function Purchases() {
  const { awCosts, invoices } = useLoaderData<typeof loader>();
  const ledgerFetcher = useFetcher<typeof action>();
  const invoiceFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  // --- Primary: AW order ledger state ---
  const [ledgerRows, setLedgerRows] = useState<ParsedAwLedgerRow[]>([]);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [ledgerBusy, setLedgerBusy] = useState(false);

  async function handleLedgerFile(file: File) {
    setLedgerError(null);
    setLedgerBusy(true);
    try {
      const rows = await parseAwLedgerFile(file);
      setLedgerRows(rows);
    } catch (err: any) {
      setLedgerError(err.message || "Couldn't read that file.");
    } finally {
      setLedgerBusy(false);
    }
  }

  function handleSaveLedger() {
    ledgerFetcher.submit(ledgerRows as any, { method: "post", encType: "application/json" });
    const count = ledgerRows.length;
    setLedgerRows([]);
    shopify.toast.show(`Saved ${count} order${count === 1 ? "" : "s"} from the AW ledger`);
  }

  // --- Optional: AW invoice PDF/paste state ---
  const [pastedText, setPastedText] = useState("");
  const [parsedInvoices, setParsedInvoices] = useState<ParsedInvoice[]>([]);
  const [invoiceParseError, setInvoiceParseError] = useState<string | null>(null);
  const [invoiceBusy, setInvoiceBusy] = useState(false);

  async function handleInvoiceFile(file: File) {
    setInvoiceParseError(null);
    setInvoiceBusy(true);
    try {
      const text = file.name.toLowerCase().endsWith(".pdf") ? await extractPdfText(file) : await file.text();
      runInvoiceParse(text);
    } catch (err: any) {
      setInvoiceParseError(err.message || "Couldn't read that file.");
    } finally {
      setInvoiceBusy(false);
    }
  }

  function runInvoiceParse(text: string) {
    const docs = parseSupplierInvoiceText(text);
    if (!docs.length) {
      setInvoiceParseError("No invoices or refunds recognized in this text. Double-check it's an AW Dropship invoice export.");
      return;
    }
    setParsedInvoices(docs);
  }

  function handleSaveInvoices() {
    const payload = { kind: "aw_invoice", docs: parsedInvoices };
    invoiceFetcher.submit(payload as any, { method: "post", encType: "application/json" });
    const count = parsedInvoices.length;
    setParsedInvoices([]);
    setPastedText("");
    shopify.toast.show(`Saved ${count} invoice document${count === 1 ? "" : "s"}`);
  }

  const ledgerRowsPreview = ledgerRows.map((r) => [
    r.reference,
    r.clientName || "\u2014",
    r.date || "\u2014",
    r.status || "\u2014",
    r.total !== null ? fmtGBP(r.total) : "\u2014",
    r.fulfillmentOrderGid ? "will link" : "no order ref",
  ]);

  const savedLedgerRows = awCosts.map((c) => [
    c.reference,
    c.clientName || "\u2014",
    c.date ? fmtDateShort(c.date) : "\u2014",
    c.status || "\u2014",
    c.total !== null ? fmtGBP(c.total) : "\u2014",
    c.orderId ? <Badge tone="success">Linked</Badge> : <Badge>Unlinked</Badge>,
  ]);

  const invoiceRows = invoices.map((inv) => [
    inv.docNumber,
    inv.type === "refund" ? "Refund" : "Invoice",
    inv.date ? fmtDateShort(inv.date) : "\u2014",
    fmtGBP(inv.total),
    fmtGBP(inv.vat),
  ]);

  return (
    <Page>
      <TitleBar title="Purchases" />
      <BlockStack gap="500">
        {/* --- PRIMARY: AW order ledger --- */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              AW order ledger (.csv or .xlsx)
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              This is the main way to bring in AW's costs — export your order ledger from the AW Dropship portal and
              upload it here. Each row links automatically to the matching Shopify order, giving you real per-order
              margin on the Sales page, not just an overall P&L number. Parsing happens in your browser; nothing is
              sent until you hit Save.
            </Text>
            <input
              type="file"
              accept=".csv,.xlsx"
              disabled={ledgerBusy}
              onChange={(e) => e.target.files?.[0] && handleLedgerFile(e.target.files[0])}
            />
            {ledgerError && <Banner tone="critical">{ledgerError}</Banner>}
          </BlockStack>
        </Card>

        {ledgerRows.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Preview — {ledgerRows.length} row{ledgerRows.length === 1 ? "" : "s"} found
              </Text>
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "numeric", "text"]}
                headings={["Reference", "Customer", "Date", "Status", "Total", "Order link"]}
                rows={ledgerRowsPreview}
              />
              <InlineStack>
                <Button variant="primary" onClick={handleSaveLedger} loading={ledgerFetcher.state !== "idle"}>
                  {`Save ${ledgerRows.length} row${ledgerRows.length === 1 ? "" : "s"}`}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Saved AW order costs
            </Text>
            {awCosts.length ? (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "numeric", "text"]}
                headings={["Reference", "Customer", "Date", "Status", "Total", "Order link"]}
                rows={savedLedgerRows}
              />
            ) : (
              <Text as="p" tone="subdued">
                No AW order ledger uploaded yet.
              </Text>
            )}
          </BlockStack>
        </Card>

        <Divider />

        {/* --- OPTIONAL: AW invoice PDF / paste --- */}
        <Card>
          <BlockStack gap="400">
            <InlineStack gap="200">
              <Text as="h2" variant="headingMd">
                AW invoice PDF
              </Text>
              <Badge>Optional</Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Not required for your Dashboard/P&L/VAT numbers — the order ledger above already covers that. Upload
              invoices here if you want the formal invoice record for your books, or product-level SKU detail for
              future margin-by-product reporting.
            </Text>
            <input
              type="file"
              accept="application/pdf,.txt"
              disabled={invoiceBusy}
              onChange={(e) => e.target.files?.[0] && handleInvoiceFile(e.target.files[0])}
            />
            <TextField
              label="Or paste invoice text"
              labelHidden
              placeholder="Paste AW invoice/refund text here"
              multiline={4}
              autoComplete="off"
              value={pastedText}
              onChange={setPastedText}
            />
            <InlineStack gap="200">
              <Button onClick={() => runInvoiceParse(pastedText)} disabled={!pastedText.trim() || invoiceBusy}>
                Parse pasted text
              </Button>
            </InlineStack>
            {invoiceParseError && <Banner tone="critical">{invoiceParseError}</Banner>}
          </BlockStack>
        </Card>

        {parsedInvoices.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Preview — {parsedInvoices.length} document{parsedInvoices.length === 1 ? "" : "s"} found
              </Text>
              {parsedInvoices.map((doc) => (
                <Card key={doc.docNumber} background="bg-surface-secondary">
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" fontWeight="semibold">
                        {doc.docNumber} — {doc.type === "refund" ? "Refund" : "Invoice"}
                      </Text>
                      <Badge tone={doc.type === "refund" ? "critical" : "success"}>{doc.date || "no date"}</Badge>
                    </InlineStack>
                    <Text as="p" variant="bodySm">
                      Total {fmtGBP(doc.total)} · VAT {fmtGBP(doc.vat)} · {doc.lineItems.length} line item
                      {doc.lineItems.length === 1 ? "" : "s"}
                      {doc.lineItems.some((li) => isFulfillmentCode(li.code)) ? " (includes fulfillment/shipping codes)" : ""}
                    </Text>
                  </BlockStack>
                </Card>
              ))}
              <InlineStack>
                <Button variant="primary" onClick={handleSaveInvoices} loading={invoiceFetcher.state !== "idle"}>
                  {`Save ${parsedInvoices.length} document${parsedInvoices.length === 1 ? "" : "s"}`}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Saved invoices
            </Text>
            {invoices.length ? (
              <DataTable
                columnContentTypes={["text", "text", "text", "numeric", "numeric"]}
                headings={["Doc number", "Type", "Date", "Total", "VAT"]}
                rows={invoiceRows}
              />
            ) : (
              <Text as="p" tone="subdued">
                No AW invoices uploaded yet.
              </Text>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
