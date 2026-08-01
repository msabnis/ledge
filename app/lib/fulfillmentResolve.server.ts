import type { PrismaClient } from "@prisma/client";

/**
 * Resolves an AW ledger row's "Platform order" FulfillmentOrder GID to our own
 * Order record, via one GraphQL call to Shopify plus a lookup in our own DB.
 *
 * Returns null (not an error) if resolution fails for any reason — an
 * unresolved row still gets saved and still counts toward P&L/VAT totals,
 * it just won't show a per-order link on the Sales page until it resolves.
 * Safe to call repeatedly: callers should skip already-resolved rows rather
 * than re-resolve on every import (see app.purchases.tsx).
 *
 * VERIFY BEFORE RELYING ON THIS: like the historical backfill query, this
 * hasn't been run against a real store — confirm `fulfillmentOrder(id:)` and
 * its `order` field still match the current Admin API schema in GraphiQL
 * before trusting it at scale.
 */
const RESOLVE_QUERY = `#graphql
  query ResolveFulfillmentOrder($id: ID!) {
    fulfillmentOrder(id: $id) {
      order {
        legacyResourceId
      }
    }
  }
`;

export async function resolveFulfillmentOrderGid(
  admin: any,
  db: PrismaClient,
  shop: string,
  gid: string,
): Promise<string | null> {
  try {
    const response = await admin.graphql(RESOLVE_QUERY, { variables: { id: gid } });
    const body = await response.json();
    const legacyResourceId: string | undefined = body?.data?.fulfillmentOrder?.order?.legacyResourceId;
    if (!legacyResourceId) return null;

    const order = await db.order.findUnique({
      where: { shop_shopifyOrderId: { shop, shopifyOrderId: String(legacyResourceId) } },
      select: { id: true },
    });
    return order?.id ?? null;
  } catch (err) {
    console.error(`Failed to resolve fulfillment order ${gid}:`, err);
    return null;
  }
}
