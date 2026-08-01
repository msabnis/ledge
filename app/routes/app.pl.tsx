import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { Page, Card, BlockStack, InlineGrid, Text, Select, DataTable } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { computePL } from "../lib/ledger.server";
import { resolveRange, type RangePreset } from "../lib/dates";
import { fmtGBP, fmtPct } from "../lib/format";
import { RANGE_OPTIONS } from "./app._index";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const preset = (url.searchParams.get("range") as RangePreset) || "fy";
  const range = resolveRange({ preset });

  const [orders, awCosts] = await Promise.all([
    db.order.findMany({ where: { shop } }),
    db.awOrderCost.findMany({ where: { shop } }),
  ]);

  const pl = computePL(orders, awCosts, range);
  return { pl, preset };
};

export default function ProfitAndLoss() {
  const { pl, preset } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();

  const rows = pl.rows.map((r) => [r.label, fmtGBP(r.revenue), fmtGBP(r.cogs), fmtGBP(r.profit)]);

  return (
    <Page>
      <TitleBar title="Profit & Loss" />
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <Select
              label="Date range"
              labelInline
              options={RANGE_OPTIONS}
              value={preset}
              onChange={(value) => setSearchParams({ range: value })}
            />
            <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
              <SummaryStat label="Revenue" value={fmtGBP(pl.revenue)} />
              <SummaryStat label="AW cost of goods" value={fmtGBP(pl.cogs)} />
              <SummaryStat label="Gross profit" value={`${fmtGBP(pl.grossProfit)} (${fmtPct(pl.marginPct)})`} />
            </InlineGrid>
          </BlockStack>
        </Card>
        <Card>
          <DataTable
            columnContentTypes={["text", "numeric", "numeric", "numeric"]}
            headings={["Month", "Revenue", "AW cost", "Profit"]}
            rows={rows}
          />
        </Card>
      </BlockStack>
    </Page>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
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
