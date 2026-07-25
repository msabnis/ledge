import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { Page, Card, BlockStack, InlineGrid, Text, Select, Banner } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { computeVATReturn } from "../lib/ledger.server";
import { resolveRange, type RangePreset } from "../lib/dates";
import { fmtGBP } from "../lib/format";
import { RANGE_OPTIONS } from "./app._index";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const preset = (url.searchParams.get("range") as RangePreset) || "quarter";
  const range = resolveRange({ preset });

  const [orders, invoices, settings] = await Promise.all([
    db.order.findMany({ where: { shop } }),
    db.supplierInvoice.findMany({ where: { shop } }),
    db.shopSettings.findUnique({ where: { shop } }),
  ]);

  const vat = computeVATReturn(orders, invoices, range);
  return { vat, preset, vatRegistered: settings?.vatRegistered ?? false };
};

export default function VAT() {
  const { vat, preset, vatRegistered } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();

  return (
    <Page>
      <TitleBar title="VAT" />
      <BlockStack gap="500">
        {!vatRegistered && (
          <Banner tone="info">
            This shop isn't marked as VAT-registered in Settings. The numbers below are still calculated — turn on
            VAT registration in Settings once you have a number, so this screen reflects your actual filing position.
          </Banner>
        )}
        <Card>
          <BlockStack gap="400">
            <Select
              label="VAT period"
              labelInline
              options={RANGE_OPTIONS}
              value={preset}
              onChange={(value) => setSearchParams({ range: value })}
            />
            <InlineGrid columns={{ xs: 2, md: 3 }} gap="400">
              <Stat label="Output VAT (Box 1)" value={fmtGBP(vat.outputVAT)} />
              <Stat label="Input VAT (Box 4)" value={fmtGBP(vat.inputVAT)} />
              <Stat label="Net VAT due (Box 5)" value={fmtGBP(vat.netVATdue)} />
              <Stat label="Net sales excl. VAT (Box 6)" value={fmtGBP(vat.box6)} />
              <Stat label="Net purchases excl. VAT (Box 7)" value={fmtGBP(vat.box7)} />
            </InlineGrid>
          </BlockStack>
        </Card>
        <Text as="p" variant="bodySm" tone="subdued">
          Box numbers follow the UK VAT return (HMRC MTD). Output VAT comes from Shopify order taxes; input VAT comes
          from parsed AW invoices. This is a working figure to help you prepare your return, not a filing — always
          check against HMRC's own portal before submitting.
        </Text>
      </BlockStack>
    </Page>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <BlockStack gap="100">
      <Text as="p" variant="bodySm" tone="subdued">
        {label}
      </Text>
      <Text as="p" variant="headingMd">
        {value}
      </Text>
    </BlockStack>
  );
}
