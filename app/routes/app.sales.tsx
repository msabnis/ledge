import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, DataTable, Text, EmptyState } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { fmtGBP, fmtPct } from "../lib/format";
import { fmtDateShort } from "../lib/dates";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const orders = await db.order.findMany({
    where: { shop },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    take: 100,
    include: { awOrderCosts: true },
  });

  return { orders };
};

export default function Sales() {
  const { orders } = useLoaderData<typeof loader>();

  if (!orders.length) {
    return (
      <Page>
        <TitleBar title="Sales" />
        <Card>
          <EmptyState
            heading="No orders synced yet"
            image="https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg"
          >
            <p>
              Orders sync automatically from Shopify as they come in. If you just installed the app, the historical
              backfill runs on your first Dashboard visit.
            </p>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  const rows = orders.map((o) => {
    const net = o.total - (o.refundedAmount || 0);
    // An order can in principle have more than one AW ledger row (split
    // fulfillment); sum them for the order's total AW cost.
    const awCost = o.awOrderCosts.reduce((s, c) => s + (c.total || 0), 0);
    const hasCost = o.awOrderCosts.length > 0;
    const margin = hasCost && net ? ((net - awCost) / net) * 100 : null;

    return [
      o.name,
      o.paidAt ? fmtDateShort(o.paidAt) : "\u2014",
      o.cancelledAt ? "Cancelled" : o.status || "\u2014",
      fmtGBP(o.total),
      o.refundedAmount ? fmtGBP(o.refundedAmount) : "\u2014",
      fmtGBP(net),
      hasCost ? fmtGBP(awCost) : "\u2014",
      hasCost ? fmtPct(margin) : "pending AW ledger",
    ];
  });

  return (
    <Page>
      <TitleBar title="Sales" />
      <Card>
        <DataTable
          columnContentTypes={["text", "text", "text", "numeric", "numeric", "numeric", "numeric", "numeric"]}
          headings={["Order", "Paid", "Status", "Total", "Refunded", "Net", "AW cost", "Margin"]}
          rows={rows}
        />
      </Card>
      <Text as="p" variant="bodySm" tone="subdued">
        Showing the most recent 100 orders. AW cost and margin appear once the matching row from an uploaded AW order
        ledger has been linked to this order — upload one on the Purchases page.
      </Text>
    </Page>
  );
}
