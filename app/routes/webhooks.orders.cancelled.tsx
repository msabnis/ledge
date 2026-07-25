import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const shopifyOrderId = String((payload as any).id);
  await db.order.updateMany({
    where: { shop, shopifyOrderId },
    data: {
      cancelledAt: (payload as any).cancelled_at ? new Date((payload as any).cancelled_at) : new Date(),
      status: (payload as any).financial_status ?? undefined,
    },
  });

  return new Response();
};
