import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Page, Card, BlockStack, InlineStack, Button, TextField, DataTable, Text, Badge, Banner } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { extractPdfText } from "../lib/pdfExtract.client";
import { parseSupplierInvoiceText, isFulfillmentCode, type ParsedInvoice } from "../lib/invoiceParser";
import { fmtGBP } from "../lib/format";
import { parseDateLoose, fmtDateShort } from "../lib/dates";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const invoices = await db.supplierInvoice.findMany({
    where: { shop },
    orderBy: { date: "desc" },
    take: 50,
  });

  return { invoices };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const docs: ParsedInvoice[] = await request.json();

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

  return { saved };
};

export default function Purchases() {
  const { invoices } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [pastedText, setPastedText] = useState("");
  const [parsed, setParsed] = useState<ParsedInvoice[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    setParseError(null);
    setBusy(true);
    try {
      const text = file.name.toLowerCase().endsWith(".pdf") ? await extractPdfText(file) : await file.text();
      runParse(text);
    } catch (err: any) {
      setParseError(err.message || "Couldn't read that file.");
    } finally {
      setBusy(false);
    }
  }

  function runParse(text: string) {
    const docs = parseSupplierInvoiceText(text);
    if (!docs.length) {
      setParseError("No invoices or refunds recognized in this text. Double-check it's an AW Dropship invoice export.");
      return;
    }
    setParsed(docs);
  }

  function handleSave() {
    // fetcher.submit's JSON encType wants a plain JSON-serializable value;
    // ParsedInvoice's typed interface doesn't structurally match that out of
    // the box, so cast rather than loosen the interface used everywhere else.
    fetcher.submit(parsed as any, { method: "post", encType: "application/json" });
    setParsed([]);
    setPastedText("");
    shopify.toast.show(`Saved ${parsed.length} document${parsed.length === 1 ? "" : "s"}`);
  }

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
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Upload an AW invoice
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              PDF export from AW Dropship, or paste the invoice text directly. Parsing happens in your browser —
              nothing is sent anywhere until you click Save.
            </Text>
            <input
              type="file"
              accept="application/pdf,.txt"
              disabled={busy}
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
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
              <Button onClick={() => runParse(pastedText)} disabled={!pastedText.trim() || busy}>
                Parse pasted text
              </Button>
            </InlineStack>
            {parseError && <Banner tone="critical">{parseError}</Banner>}
          </BlockStack>
        </Card>

        {parsed.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Preview — {parsed.length} document{parsed.length === 1 ? "" : "s"} found
              </Text>
              {parsed.map((doc) => (
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
                <Button variant="primary" onClick={handleSave} loading={fetcher.state !== "idle"}>
                  {`Save ${parsed.length} document${parsed.length === 1 ? "" : "s"}`}
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
