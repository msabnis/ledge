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
  const [settings, orderCount] = await Promise.all([
    db.shopSettings.upsert({ where: { shop }, create: { shop }, update: {} }),
    db.order.count({ where: { shop } }),
  ]);
  return { settings, orderCount };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();

  if (body.kind === "reset_and_resync") {
    // AwOrderCost rows link to Order by internal id, not shopifyOrderId — those
    // ids won't survive a delete+recreate, so unlink first rather than leave
    // dangling references (the uploaded AW ledger data itself is untouched;
    // only the Shopify-sourced order data gets wiped and re-fetched here).
    await db.awOrderCost.updateMany({ where: { shop, orderId: { not: null } }, data: { orderId: null } });
    await db.order.deleteMany({ where: { shop } }); // cascades to OrderLineItem
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
  const { settings, orderCount } = useLoaderData<typeof loader>();
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
      "This deletes every synced order in this app's database and re-fetches your full order history from Shopify. " +
        "Your uploaded AW ledger/invoice data is not affected, but order-to-cost links will need to re-resolve. Continue?",
    );
    if (!ok) return;
    resetFetcher.submit({ kind: "reset_and_resync" }, { method: "post", encType: "application/json" });
  }

  useEffect(() => {
    if (resetFetcher.data?.kind === "reset_and_resync") {
      shopify.toast.show(`Re-synced ${resetFetcher.data.orderCount} orders from Shopify`);
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
              Currently {orderCount} order{orderCount === 1 ? "" : "s"} synced. This deletes them all from the app's
              database and re-fetches your complete order history straight from Shopify — useful after testing
              changes to the sync logic, or if the local data ever looks wrong. Your uploaded AW ledger and invoice
              data is untouched.
            </Text>
            <Button tone="critical" onClick={handleResetAndResync} loading={resetFetcher.state !== "idle"}>
              Reset orders &amp; re-sync from Shopify
            </Button>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
