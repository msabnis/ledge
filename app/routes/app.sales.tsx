import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, DataTable, Text, EmptyState } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { fmtGBP } from "../lib/format";
import { fmtDateShort } from "../lib/dates";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const orders = await db.order.findMany({
    where: { shop },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    take: 100,
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

  const rows = orders.map((o) => [
    o.name,
    o.paidAt ? fmtDateShort(o.paidAt) : "\u2014",
    o.cancelledAt ? "Cancelled" : o.status || "\u2014",
    fmtGBP(o.total),
    o.refundedAmount ? fmtGBP(o.refundedAmount) : "\u2014",
    fmtGBP(o.total - (o.refundedAmount || 0)),
  ]);

  return (
    <Page>
      <TitleBar title="Sales" />
      <Card>
        <DataTable
          columnContentTypes={["text", "text", "text", "numeric", "numeric", "numeric"]}
          headings={["Order", "Paid", "Status", "Total", "Refunded", "Net"]}
          rows={rows}
        />
      </Card>
      <Text as="p" variant="bodySm" tone="subdued">
        Showing the most recent 100 orders.
      </Text>
    </Page>
  );
}
