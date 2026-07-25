import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Page, Card, BlockStack, TextField, Checkbox, Button } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = await db.shopSettings.upsert({ where: { shop }, create: { shop }, update: {} });
  return { settings };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();

  const settings = await db.shopSettings.update({
    where: { shop },
    data: {
      companyName: body.companyName || null,
      vatRegistered: Boolean(body.vatRegistered),
      vatNumber: body.vatRegistered ? body.vatNumber || null : null,
    },
  });

  return { settings };
};

export default function Settings() {
  const { settings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [companyName, setCompanyName] = useState(settings.companyName || "");
  const [vatRegistered, setVatRegistered] = useState(settings.vatRegistered);
  const [vatNumber, setVatNumber] = useState(settings.vatNumber || "");

  function handleSave() {
    fetcher.submit(
      { companyName, vatRegistered, vatNumber },
      { method: "post", encType: "application/json" },
    );
    shopify.toast.show("Settings saved");
  }

  return (
    <Page>
      <TitleBar title="Settings" />
      <Card>
        <BlockStack gap="400">
          <TextField
            label="Company name"
            autoComplete="organization"
            value={companyName}
            onChange={setCompanyName}
            helpText="Shown on your Dashboard and used to label exports. Not sent anywhere else."
          />
          <Checkbox
            label="VAT registered"
            checked={vatRegistered}
            onChange={setVatRegistered}
          />
          {vatRegistered && (
            <TextField
              label="VAT number"
              autoComplete="off"
              value={vatNumber}
              onChange={setVatNumber}
            />
          )}
          <Button variant="primary" onClick={handleSave} loading={fetcher.state !== "idle"}>
            Save
          </Button>
        </BlockStack>
      </Card>
    </Page>
  );
}
