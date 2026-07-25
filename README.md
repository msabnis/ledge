# Ledge

A Shopify app for AW Dropship sellers — reconciling Shopify sales against AW supplier costs to show true margin, P&L, and VAT position.

See `PLAN.md` for the full project plan (strategy, MVP scope, Stage 2 roadmap). Keep that file updated as decisions get made.

## Status

Scaffolded, not yet deployed. Built on Shopify's official Remix app template, with:

- Postgres/Prisma schema for shops, orders, and AW supplier invoices
- Webhook handlers for live order sync (`orders/create`, `orders/updated`, `orders/cancelled`, `refunds/create`)
- A one-time historical order backfill on first load (GraphQL Admin API)
- The P&L / VAT / margin calculation engine and AW invoice parser, ported from the original ledger build
- Five Polaris screens: Dashboard, P&L, VAT, Sales, Purchases, Settings

`npm install`, `npx tsc --noEmit`, and `npm run build` all pass clean as of the last commit. **Not yet verified**: `prisma generate`/`migrate` (this was built in a sandboxed environment with no route to Prisma's engine download CDN), a live OAuth install, or a Railway deploy. Treat those as the next steps, not as done.

## First-time setup

1. **Install dependencies**
   ```
   npm install
   ```

2. **Create the app in your Shopify Partner Dashboard**, then link this repo to it:
   ```
   npm run config:link
   ```
   This fills in `client_id` in `shopify.app.toml` and writes your API key/secret.

3. **Database** — for local dev, easiest is a local Postgres or a free Railway Postgres instance. Set `DATABASE_URL` in a `.env` file (copy `.env.example`), then:
   ```
   npx prisma generate
   npx prisma migrate dev --name init
   ```

4. **Run it against a dev store**:
   ```
   npm run dev
   ```
   This opens the Shopify CLI's dev flow — pick or create a Partner dev store, and it'll give you a tunnel URL and install link.

5. **Apply for the `read_all_orders` scope** in the Partner Dashboard (API access request form) — standard `read_orders` only returns 60 days of history. This is a review-form delay, not engineering work, so worth kicking off early. Once approved, update `scopes` in `shopify.app.toml`.

## Deploying (Railway)

1. Create a new Railway project, add a **Postgres** plugin.
2. Connect this GitHub repo — Railway will detect the `Dockerfile` and use it automatically.
3. Set service environment variables: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `SHOPIFY_APP_URL` (your Railway-provided domain, or a custom domain), and `DATABASE_URL` (copy from the Postgres plugin's "Connect" tab).
4. Push to `master` — Railway auto-deploys. The Docker image's start command (`npm run docker-start`) runs `prisma migrate deploy` before starting the server, so schema migrations apply automatically on every deploy.

## Structure

- `PLAN.md` — living project plan, update as we go
- `reference/tatsatiti-ledger-original.html` — the original single-tenant, browser-based ledger tool this project is built from. Kept for reference only; not part of the shipped app.
- `app/lib/` — the framework-agnostic core: date/format helpers, the calculation engine (`ledger.server.ts`), the AW invoice parser (`invoiceParser.ts`), client-side PDF text extraction (`pdfExtract.client.ts`), and order-sync/backfill helpers shared between webhooks and the historical backfill.
- `app/routes/app.*.tsx` — the five merchant-facing screens.
- `app/routes/webhooks.*.tsx` — webhook handlers.
- `prisma/schema.prisma` — data model (see `PLAN.md` Section 4 for the sketch this follows).

## Known simplifications worth revisiting

- **Refund idempotency** (`app/lib/orderSync.server.ts`): refund amounts are applied by incrementing a running total. If Shopify redelivers the same `refunds/create` webhook, it'll double-count. Fine for a small beta, worth hardening (e.g. a processed-refund-ids table) before wider rollout.
- **Backfill runs synchronously** in the Dashboard's loader on first load. Fine for a dev store or a beta merchant with a modest order history; move to a background job before a merchant with thousands of historical orders installs.
- **Backfill GraphQL query** — verify field names against the live Admin API schema (via the GraphiQL explorer `shopify app dev` links to) before relying on it; API field names drift between versions and this hasn't been run against a real store yet.
- **AW invoice parser** is tuned to AW's UK invoice text layout specifically. Slovakia/Spain formats are unconfirmed — see `PLAN.md` Section 5a.
- **GDPR compliance webhooks** (`customers/data_request`, `customers/redact`, `shop/redact`) are commented out in `shopify.app.toml` and not implemented. Mandatory before any public App Store listing — add as a pre-launch checklist item, not a beta-blocker.
