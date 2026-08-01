import type { PrismaClient } from "@prisma/client";
import { upsertOrderFromPayload } from "./orderSync.server";

/**
 * One-time historical order backfill, run on a shop's first load after
 * install (see app/routes/app._index.tsx). Pages through the shop's past
 * orders via the GraphQL Admin API and upserts each one.
 *
 * VERIFY BEFORE RELYING ON THIS: field names on Order/LineItem occasionally
 * shift between Admin API versions. Confirm this query still matches the
 * current schema in the GraphiQL explorer (`shopify app dev` prints a link)
 * before running it against a real merchant's store — don't assume it's
 * still correct without checking, API field names do drift.
 *
 * Known limitation: this runs synchronously in a Remix loader. Fine for a
 * dev store or a beta merchant with a few hundred orders; for anyone with a
 * large order history this will be slow and should move to a background
 * job (Railway cron, a queue, etc.) before wider rollout.
 */
const ORDERS_QUERY = `#graphql
  query BackfillOrders($cursor: String) {
    orders(first: 100, after: $cursor, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          legacyResourceId
          name
          displayFinancialStatus
          createdAt
          processedAt
          cancelledAt
          
          currencyCode
          subtotalPriceSet { shopMoney { amount } }
          totalShippingPriceSet { shopMoney { amount } }
          totalTaxSet { shopMoney { amount } }
          totalPriceSet { shopMoney { amount } }
          lineItems(first: 100) {
            edges {
              node {
                sku
                title
                quantity
                vendor
                originalUnitPriceSet { shopMoney { amount } }
              }
            }
          }
        }
      }
    }
  }
`;

/** Converts a GraphQL order node into the REST-payload shape upsertOrderFromPayload expects,
 *  so webhook sync and backfill share one mapping (see orderSync.server.ts). */
function toRestShape(node: any) {
  return {
    id: node.legacyResourceId,
    name: node.name,
    financial_status: (node.displayFinancialStatus || "").toLowerCase(),
    created_at: node.createdAt,
    processed_at: node.processedAt,
    cancelled_at: node.cancelledAt,
 
    currency: node.currencyCode,
    subtotal_price: node.subtotalPriceSet?.shopMoney?.amount,
    total_shipping_price_set: node.totalShippingPriceSet,
    total_tax: node.totalTaxSet?.shopMoney?.amount,
    total_price: node.totalPriceSet?.shopMoney?.amount,
    line_items: (node.lineItems?.edges || []).map((e: any) => ({
      sku: e.node.sku,
      title: e.node.title,
      quantity: e.node.quantity,
      vendor: e.node.vendor,
      price: e.node.originalUnitPriceSet?.shopMoney?.amount,
    })),
  };
}

export async function backfillHistoricalOrders(admin: any, db: PrismaClient, shop: string): Promise<number> {
  let cursor: string | null = null;
  let hasNextPage = true;
  let count = 0;

  while (hasNextPage) {
    const response: any = await admin.graphql(ORDERS_QUERY, { variables: { cursor } });
    const body: any = await response.json();
    const edges: any[] = body.data.orders.edges;
    const pageInfo: { hasNextPage: boolean; endCursor: string | null } = body.data.orders.pageInfo;

    for (const edge of edges) {
      await upsertOrderFromPayload(db, shop, toRestShape(edge.node));
      count++;
    }

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  await db.shopSettings.update({ where: { shop }, data: { backfilledAt: new Date() } });
  console.log(`Backfill complete for ${shop}: ${count} orders`);
  return count;
}
