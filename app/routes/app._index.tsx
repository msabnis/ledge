import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineGrid, Text, Select } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { backfillHistoricalOrders } from "../lib/backfill.server";
import { computeKPIs } from "../lib/ledger.server";
import { resolveRange, type RangePreset } from "../lib/dates";
import { fmtGBP, fmtPct, fmtNum } from "../lib/format";

export const RANGE_OPTIONS = [
  { label: "This month", value: "month" },
  { label: "Last 90 days", value: "quarter" },
  { label: "This tax year", value: "fy" },
  { label: "All time", value: "all" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Ensure a settings row exists, then run the one-time historical backfill
  // the very first time this shop loads the app post-install.
  const settings = await db.shopSettings.upsert({ where: { shop }, create: { shop }, update: {} });
  if (!settings.backfilledAt) {
    await backfillHistoricalOrders(admin, db, shop);
  }

  const url = new URL(request.url);
  const preset = (url.searchParams.get("range") as RangePreset) || "month";
  const range = resolveRange({ preset });

  const [orders, awCosts] = await Promise.all([
    db.order.findMany({ where: { shop } }),
    db.awOrderCost.findMany({ where: { shop } }),
  ]);

  const kpis = computeKPIs(orders, awCosts, range);

  return { kpis, preset, companyName: settings.companyName };
};

export default function Dashboard() {
  const { kpis, preset, companyName } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();

  return (
    <Page>
      <TitleBar title={companyName ? `${companyName} — Dashboard` : "Dashboard"} />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Select
                  label="Date range"
                  labelInline
                  options={RANGE_OPTIONS}
                  value={preset}
                  onChange={(value) => setSearchParams({ range: value })}
                />
                <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
                  <KPICard label="Revenue" value={fmtGBP(kpis.revenue)} />
                  <KPICard label="AW cost" value={fmtGBP(kpis.cogs)} />
                  <KPICard label="True margin" value={fmtPct(kpis.margin)} />
                  <KPICard label="Orders" value={fmtNum(kpis.ordersCount)} />
                </InlineGrid>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

function KPICard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="headingLg">
          {value}
        </Text>
      </BlockStack>
    </Card>
  );
}
