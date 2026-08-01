import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Page, Card, BlockStack, TextField, Checkbox, Button, Text, Banner } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { backfillHistoricalOrders } from "../lib/backfill.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [settings, orderCount, awCostCount, invoiceCount] = await Promise.all([
    db.shopSettings.upsert({ where: { shop }, create: { shop }, update: {} }),
    db.order.count({ where: { shop } }),
    db.awOrderCost.count({ where: { shop } }),
    db.supplierInvoice.count({ where: { shop } }),
  ]);
  return { settings, orderCount, awCostCount, invoiceCount };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();

  if (body.kind === "reset_and_resync") {
    // Full wipe for a clean testing slate: AW ledger rows and invoice PDFs
    // (deleted here, not just unlinked, per explicit request) plus every
    // synced order — then a full re-fetch from Shopify. AwOrderCost is
    // deleted before Order to avoid a foreign-key conflict (it references
    // Order.id); SupplierInvoiceLineItem and OrderLineItem both cascade
    // automatically from their parent deletes.
    await db.awOrderCost.deleteMany({ where: { shop } });
    await db.supplierInvoice.deleteMany({ where: { shop } });
    await db.order.deleteMany({ where: { shop } });
    await db.shopSettings.update({ where: { shop }, data: { backfilledAt: null } });
    const count = await backfillHistoricalOrders(admin, db, shop);
    return { kind: "reset_and_resync" as const, orderCount: count };
  }

  const settings = await db.shopSettings.update({
    where: { shop },
    data: {
      companyName: body.companyName || null,
      vatRegistered: Boolean(body.vatRegistered),
      vatNumber: body.vatRegistered ? body.vatNumber || null : null,
    },
  });
  return { kind: "save_settings" as const, settings };
};

export default function Settings() {
  const { settings, orderCount, awCostCount, invoiceCount } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const resetFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [companyName, setCompanyName] = useState(settings.companyName || "");
  const [vatRegistered, setVatRegistered] = useState(settings.vatRegistered);
  const [vatNumber, setVatNumber] = useState(settings.vatNumber || "");

  function handleSave() {
    fetcher.submit({ companyName, vatRegistered, vatNumber }, { method: "post", encType: "application/json" });
    shopify.toast.show("Settings saved");
  }

  function handleResetAndResync() {
    const ok = window.confirm(
      `This permanently deletes ${orderCount} synced order(s), ${awCostCount} AW ledger row(s), and ${invoiceCount} ` +
        "AW invoice record(s) from this app's database, then re-fetches your full order history from Shopify. " +
        "There's no undo — you'd need to re-upload your AW ledger/invoice files afterward. Continue?",
    );
    if (!ok) return;
    resetFetcher.submit({ kind: "reset_and_resync" }, { method: "post", encType: "application/json" });
  }

  useEffect(() => {
    if (resetFetcher.data?.kind === "reset_and_resync") {
      shopify.toast.show(`Reset complete — re-synced ${resetFetcher.data.orderCount} orders from Shopify`);
    }
  }, [resetFetcher.data, shopify]);

  return (
    <Page>
      <TitleBar title="Settings" />
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <TextField
              label="Company name"
              autoComplete="organization"
              value={companyName}
              onChange={setCompanyName}
              helpText="Shown on your Dashboard and used to label exports. Not sent anywhere else."
            />
            <Checkbox label="VAT registered" checked={vatRegistered} onChange={setVatRegistered} />
            {vatRegistered && (
              <TextField label="VAT number" autoComplete="off" value={vatNumber} onChange={setVatNumber} />
            )}
            <Button variant="primary" onClick={handleSave} loading={fetcher.state !== "idle"}>
              Save
            </Button>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Danger zone
            </Text>
            <Banner tone="warning">
              Development/testing tool. Not something to expose to real merchants without a permission check — worth
              revisiting before this app is used outside your own beta testing.
            </Banner>
            <Text as="p" variant="bodySm" tone="subdued">
              Currently {orderCount} order{orderCount === 1 ? "" : "s"}, {awCostCount} AW ledger row
              {awCostCount === 1 ? "" : "s"}, and {invoiceCount} AW invoice{invoiceCount === 1 ? "" : "s"} stored.
              This is a full wipe for a clean testing slate — deletes all of it, then re-fetches order history from
              Shopify. AW ledger/invoice data does <Text as="span" fontWeight="semibold">not</Text> come back
              automatically; re-upload those files afterward if you need them.
            </Text>
            <Button tone="critical" onClick={handleResetAndResync} loading={resetFetcher.state !== "idle"}>
              Full reset &amp; re-sync from Shopify
            </Button>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
