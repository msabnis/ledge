# Context — for picking this project up in a new chat

Purpose of this file specifically: a fast-onboarding primer covering what's been *built, broken, fixed, and learned* — the stuff that isn't captured in `PLAN.md` (business strategy) or `SHOPIFY_SETUP.md` (platform config walkthrough). Read this before assuming something works or re-diagnosing something already solved.

**Last updated:** 31 Jul 2026, end of the first full local-dev debugging session.

---

## What this is, in one paragraph

Ledge is a Shopify app for AW Dropship sellers — reconciles Shopify order revenue against AW Dropship's costs to show true margin, P&L, and VAT position. Multi-tenant SaaS (one shared Postgres DB, `shop` column scoping every table), built on Shopify's official Remix app template + Polaris. Repo: `github.com/msabnis/ledge`, branch `main`. Full business strategy and roadmap lives in `PLAN.md` — this file is the technical/debugging companion.

## Current state

- **Local dev works end-to-end** on Windows (`D:\ShopifyLedge\ledge`), against dev store `ledgerlydev.myshopify.com`, currently linked as app `LedgerlyDev1.2`.
- **Never yet deployed to Railway** — Postgres is hosted there, but the app itself has only run locally so far.
- Real historical data (Shopify order CSV, AW invoice PDFs, AW's bulk order-cost ledger) has been used for testing throughout — see `PLAN.md` Section 4a for what that testing found.

---

## Architecture decisions made this session, and why

**AW cost ingestion has two paths, one source of truth.** Originally scoped as PDF-invoice-parsing only. Mid-session, testing against real data surfaced that AW's portal also exports a bulk **order-level cost ledger** (CSV/xlsx), where each row's `Platform order` field is a Shopify **FulfillmentOrder GID** — resolvable via one GraphQL call to the actual `Order`. This is now the **primary** cost source (`AwOrderCost` table), feeding P&L/VAT/Dashboard directly and enabling real **per-order margin** on the Sales page. The PDF invoice parser (`SupplierInvoice` table) is kept as an **optional** supplementary record — formal invoice number for a VAT audit trail, and product-level SKU detail the ledger doesn't carry — but is deliberately **not** summed into financial totals, to avoid double-counting the same order's cost from two uploaded documents. Full rationale in `PLAN.md` Section 4a.

**Multi-tenant from day one**, confirmed already in place when asked: every real table (`ShopSettings`, `Order`, `AwOrderCost`, `SupplierInvoice`) has a `shop` column, every query filters `where: { shop }`. This already supports the Stage 2 "cross-merchant benchmarking" idea architecturally — that feature just hasn't been built yet.

---

## Platform gotchas learned the hard way — read before assuming

1. **Shopify CLI must be installed globally** (`npm install -g @shopify/cli@latest`) — it is *not* bundled as a project dependency in this template version, despite `package.json` scripts calling it directly. Without this, `npm run dev` fails with "command not found."

2. **`shopify.web.toml` is required and easy to lose.** It's normally auto-generated (from a `.liquid` template) by the CLI's own `app init` scaffolding flow. Since Ledge was hand-assembled from the official template rather than run through that flow, this file had to be manually reconstructed after being mistaken for repo-maintenance cruft and deleted. Without it, `shopify app dev` silently falls back to a placeholder `app_home` URL and nothing loads — no error, just silence.

3. **Chained shell commands in `shopify.web.toml`'s `dev` field are unreliable on Windows.** Original: `dev = "npm exec prisma migrate deploy && npm exec remix vite:dev"` — the first half completed every time, the second half never visibly started. Fix, confirmed working: split across two fields instead of one chain —
   ```toml
   [commands]
   predev = "npm exec prisma generate && npm exec prisma migrate deploy"
   dev = "npm exec remix vite:dev"
   ```

4. **Shopify CLI's live env-var injection into `.env` (`SHOPIFY_APP_URL`, `SHOPIFY_API_KEY`/`SECRET`) did not work reliably in this environment.** Root cause never fully pinned down. `npm run env -- pull` (`shopify app env pull`) got two of the three values populated correctly; `SHOPIFY_APP_URL` stayed blank across many runs regardless. What actually fixed it: `shopify app dev --reset`, followed by explicitly creating a **fresh app record** (`LedgerlyDev1.1` → `LedgerlyDev1.2`) rather than continuing to repair the original one — a `--reset` against the original app record did not resolve it, and even regressed `scopes` to blank on top of it.

5. **A `--reset` (or creating a fresh app) can silently wipe `scopes` and `[[webhooks.subscriptions]]` from `shopify.app.toml`.** Happened more than once. Always diff/check the file after any reset or relink — don't assume only `client_id`/`application_url` changed.

6. **Protected customer data is a separate approval from scopes**, and gates order data — including the `email` field specifically — on any real store. Dev stores mostly get a pass, but even on a dev store, a GraphQL query requesting `email` threw `GraphqlQueryError: not approved to use the email field`. Notably, **REST webhooks behave differently from GraphQL queries** here: webhooks silently redact unapproved fields (deliver `null`), GraphQL queries hard-fail the whole request. Fixed by removing `email` from the historical-backfill GraphQL query — it wasn't displayed anywhere in the app anyway.

7. **Resolving a FulfillmentOrder GID needs its own scope**, separate from `read_orders`: specifically `read_third_party_fulfillment_orders` (AW is a third-party fulfillment service from the merchant's store's perspective — a different scope would apply if the merchant fulfilled in-house via `read_merchant_managed_fulfillment_orders`). Confirmed via a live GraphiQL 403 that named the exact scope required — this is generally the fastest way to find the *correct* scope when access is denied, rather than guessing from docs.

8. **A FulfillmentOrder GID's numeric ID and an Order's numeric ID are separate sequences and can coincidentally match without being related.** Discovered this the hard way — a set of manually-created dev-store test orders happened to share exact numeric IDs with unrelated real GIDs from a production AW export, which looked like confirmation of a working link but wasn't. Only a live, correctly-scoped GraphQL query is trustworthy proof of a real link — never infer it from matching numbers alone.

9. **`useLoaderData` JSON-serializes data crossing from server to browser** — real `Date` objects from Prisma become plain ISO strings by the time a component renders them, even though the exact same code sees a real `Date` server-side. Any display function expecting a `Date` needs to coerce defensively (`d instanceof Date ? d : new Date(d)`) or it'll throw on the client (`d.getDate is not a function`) despite working fine in the loader.

10. **Windows Explorer hides dotfiles** (`.env`, `.env.example`) by default under some Git-for-Windows configurations. Use `dir /a` in cmd, or enable "Hidden items" in Explorer's View tab — don't assume a file is missing just because Explorer doesn't show it.

11. **Railway Postgres only allows private-network connections by default.** Needed to explicitly enable Public Networking on the Postgres service to get a connection string reachable from a local Windows dev machine. Switch back to the private URL once the app itself is also deployed inside the same Railway project — no reason to route production traffic through the public proxy.

12. **Shopify replaced the Partner Dashboard with a "Dev Dashboard"** as part of a January 2026 platform change. All app creation/management, dev stores, and API access requests live there now. Older tutorials/forum posts referencing "Partner Dashboard" describe the same underlying thing.

13. **Custom app distribution (the no-review path) only supports multiple stores if they're on the same Shopify Plus org.** Doesn't fit the plan to recruit several independent, non-Plus AW dropshippers for beta. Public distribution with unlisted visibility (still requires Shopify's review) looks like the realistic path instead — flagged as an **open, unresolved question**, not yet decided.

---

## Real bugs found and fixed this session, in order

1. Missing `shopify.web.toml` → CLI had no way to launch the Remix dev server, silent placeholder fallback
2. `&&`-chained command in `shopify.web.toml`'s `dev` field → second half never reliably started on Windows
3. Persistently blank `SHOPIFY_APP_URL`/API key/secret in `.env` → resolved via `--reset` + linking a fresh app record
4. `fmtDateShort` crashed (`TypeError: d.getDate is not a function`) on serialized date strings arriving via `useLoaderData` → made the function coerce defensively
5. Historical-backfill GraphQL query requested `email` → blocked by protected-customer-data restrictions, not approved → removed (unused elsewhere anyway)
6. **AW ledger save silently discarded every upload** — `handleSaveLedger` submitted a bare array with no `kind` field; the server action only checked `body.kind === "aw_ledger"`, so it always fell through to an "unknown submission kind" branch and nothing was ever written to the database. Made worse by the UI showing an optimistic "Saved!" toast regardless of the real result. Fixed both: correct payload shape, and toast now reflects the actual server response (success *or* failure).
7. Missing `read_third_party_fulfillment_orders` scope → FulfillmentOrder GID resolution silently returned `null` for every row (access denied, masked as "not found") until the scope was added

---

## Confirmed working end-to-end this session

- OAuth install / local dev via CLI
- Order webhook sync (`orders/create`, `updated`, `cancelled`, `refunds/create`) — real test order confirmed synced
- Historical backfill via GraphQL Admin API — confirmed via the reset-and-resync tool
- AW invoice PDF/paste parsing → save
- AW order ledger CSV/xlsx parsing → save (after bug #6 above was fixed)
- FulfillmentOrder GID resolution mechanism — confirmed correct handling of both a successful resolution *and* a genuine "not found" (`null`, no error) case
- Dashboard/P&L/VAT calculations, sourcing from `AwOrderCost`
- Reset-and-resync dev tool (Settings → Danger zone) — full wipe of orders + AW data, re-backfill from Shopify

## NOT yet confirmed — still needs real-world testing

- **A genuinely matching AW ledger row actually linking to its Shopify order.** Everything up to this point is proven correct (parsing, saving, the resolution query itself, error handling) — what's *not* proven is a true positive, since that requires a real AW-fulfilled order, which only exists on the actual production store, not the dev sandbox. This is the single most important thing to verify once the app is installed there for real.
- Railway deployment — never actually deployed, local dev only so far
- `prisma migrate deploy` in a real production/Railway context
- Distribution method decision (Custom vs. Public+Unlisted) — see gotcha #13
- Protected customer data approval — not yet applied for; needed before any real (non-dev-store) merchant installs
- `read_all_orders` scope approval — not yet applied for; needed for order history beyond 60 days
- GDPR compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) — stubbed as commented-out in `shopify.app.toml`, not implemented. Mandatory before any public listing.

---

## Repo map

- `PLAN.md` — business strategy, MVP scope, Stage 2 roadmap. Living document, keep updated.
- `SHOPIFY_SETUP.md` — Shopify-side config walkthrough (Dev Dashboard, scopes, distribution, protected data).
- `README.md` — local dev setup instructions, Railway deploy steps.
- `CONTEXT.md` — this file.
- `reference/tatsatiti-ledger-original.html` — the original single-tenant tool this was built from; source of the ported P&L/VAT/margin calculation logic and the AW invoice parser.
- `app/lib/` — the framework-agnostic core: `ledger.server.ts` (calc engine), `invoiceParser.ts` + `pdfExtract.client.ts` (PDF path), `awLedgerParse.client.ts` + `fulfillmentResolve.server.ts` (ledger path), `backfill.server.ts`, `orderSync.server.ts`.

## Immediate next steps

- [ ] Deploy to Railway for the first time (never done yet)
- [ ] Apply for `read_all_orders` + protected customer data access in the Dev Dashboard
- [ ] Resolve the distribution-method question before recruiting beta merchants
- [ ] Implement the three GDPR compliance webhooks before any beta/public rollout
- [ ] Get real AW Slovakia/Spain invoice samples (Stage 2 EU prep, still blocked on this)
- [ ] Once installed on the real production store: confirm an actual AW ledger row links to its Shopify order — the one thing this whole session couldn't fully prove
