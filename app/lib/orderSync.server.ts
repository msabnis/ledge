import type { PrismaClient } from "@prisma/client";

/**
 * Maps a Shopify REST Order payload (from orders/create, orders/updated
 * webhooks, or the historical backfill) to our Order + OrderLineItem rows
 * and upserts it. Shared so webhooks and the backfill job can't drift apart.
 *
 * Known simplification: Shopify's order payload has no single canonical
 * "paid at" field. We treat a "paid" financial_status as paid at
 * processed_at (falling back to created_at) — good enough for v1, revisit
 * if a merchant's payment gateway makes processed_at unreliable.
 */
export async function upsertOrderFromPayload(db: PrismaClient, shop: string, payload: any) {
  const shopifyOrderId = String(payload.id);
  const isPaid = payload.financial_status === "paid" || payload.financial_status === "partially_refunded";
  const paidAt = isPaid ? new Date(payload.processed_at || payload.created_at) : null;

  const shipping =
    parseFloat(payload.total_shipping_price_set?.shop_money?.amount ?? payload.total_shipping_price ?? "0") || 0;

  const orderData = {
    shop,
    shopifyOrderId,
    name: payload.name ?? `#${shopifyOrderId}`,
    status: payload.financial_status ?? null,
    paidAt,
    cancelledAt: payload.cancelled_at ? new Date(payload.cancelled_at) : null,
    email: payload.email ?? payload.contact_email ?? null,
    subtotal: parseFloat(payload.subtotal_price ?? "0") || 0,
    shipping,
    taxes: parseFloat(payload.total_tax ?? "0") || 0,
    total: parseFloat(payload.total_price ?? "0") || 0,
    currency: payload.currency ?? "GBP",
  };

  const order = await db.order.upsert({
    where: { shop_shopifyOrderId: { shop, shopifyOrderId } },
    create: orderData,
    update: orderData,
  });

  // Simplest-correct approach for a webhook-driven sync: replace line items
  // wholesale rather than diffing. Order line item counts are small, so this
  // is cheap, and it can never drift from what Shopify actually sent us.
  await db.orderLineItem.deleteMany({ where: { orderId: order.id } });
  const lineItems = (payload.line_items || []).map((li: any) => ({
    orderId: order.id,
    sku: li.sku || null,
    name: li.title || li.name || "Unknown item",
    qty: li.quantity ?? 1,
    price: parseFloat(li.price ?? "0") || 0,
    vendor: li.vendor || null,
  }));
  if (lineItems.length) {
    await db.orderLineItem.createMany({ data: lineItems });
  }

  return order;
}

/**
 * Applies a refund webhook payload (Shopify Refund resource) to the
 * matching order's refundedAmount.
 *
 * Known simplification: increments refundedAmount by this refund's
 * transaction total. Shopify can redeliver the same webhook more than
 * once — if that happens here, the same refund would be double-counted.
 * Fine for a v1 beta with a handful of merchants; revisit with an
 * idempotency check (e.g. a processed-refund-ids table) before wider
 * rollout.
 */
export async function applyRefundFromPayload(db: PrismaClient, shop: string, payload: any) {
  const shopifyOrderId = String(payload.order_id);
  const refundTotal = (payload.transactions || [])
    .filter((t: any) => t.kind === "refund")
    .reduce((s: number, t: any) => s + (parseFloat(t.amount ?? "0") || 0), 0);

  if (!refundTotal) return;

  await db.order.updateMany({
    where: { shop, shopifyOrderId },
    data: { refundedAmount: { increment: refundTotal } },
  });
}
