# Shopify-side setup — Ledge

What needs configuring on Shopify's side, where to do it, and in what order. Companion to `PLAN.md` and `README.md` in the repo — this doc is specifically about the Shopify platform config, not the code.

**Terminology note:** Shopify replaced the old "Partner Dashboard" app-management screens with a new **Dev Dashboard** during 2025/2026. Store creation, app creation, and app config all live there now. If you land on an older tutorial or forum post that says "Partner Dashboard," it's describing the same thing — just follow whatever the CLI or your login at partners.shopify.com actually shows you, since this changed recently and screens may still be settling.

---

## 0. How the pieces fit together

Three things stay in sync, and it's worth knowing the relationship before you start clicking around:

- **The Dev Dashboard** — where the app "exists" as an entity on Shopify's side: client ID/secret, distribution method, dev stores, API access approvals.
- **`shopify.app.toml`** (in the repo) — your local, version-controlled copy of config: scopes, webhook subscriptions, URLs.
- **Shopify CLI** — the bridge between them. `shopify app dev` syncs your toml to the Dev Dashboard automatically for your dev store as you work. `shopify app deploy` releases a config version to *all* stores, including real ones. `shopify app config link` pulls the Dev Dashboard's current state down into your toml if they drift apart.

Most of what follows, you'll do once via the CLI and never think about again. A handful of things (account creation, distribution method, API access requests) can only be done by clicking around the Dev Dashboard itself.

---

## 1. Partner account & organization

If you don't already have one: [partners.shopify.com](https://partners.shopify.com) → sign up → create an organization. Free. This is the umbrella account everything else sits under.

## 2. A development store

You need at least one dev store to install and test the app against before any real merchant touches it. In the Dev Dashboard: **Stores → Add store → Create dev store**. Free, no time limit, behaves like a real store except it can't process real payments.

Dev stores get one important exemption, covered in Section 6 — worth creating this before you worry about API access approvals.

## 3. Create and link the app

From the repo root:
```
npm run dev
```
First run, the CLI walks you through: log into your Partner org → create a new app (or select an existing one) → pick your dev store to test against → opens a tunnel and gives you an install link. This writes your `client_id` into `shopify.app.toml` automatically — that's the one field in the file you don't hand-edit.

If the app already exists on Shopify's side and you just need your local `shopify.app.toml` to match it:
```
npm run config:link
```

## 4. App URLs

Two URLs the Dev Dashboard needs to know about, under the app's **URLs** settings:

- **App URL** — where Shopify loads your app from inside the merchant's admin.
- **Allowed redirection URL(s)** — where Shopify's OAuth flow is allowed to send merchants back to after they approve install. Must match exactly (scheme, host, and path) or install breaks with a redirect_uri mismatch error.

During local dev, `shopify app dev` manages both automatically via a temporary tunnel — you won't touch this. Once you deploy to Railway, update both to your real Railway domain (or custom domain) and run `shopify app deploy` to push the change live. Forgetting this step is probably the single most common reason a working local dev setup fails to install on a real store.

## 5. Scopes

Declared in `shopify.app.toml`:
```toml
[access_scopes]
scopes = "read_orders"
```
`shopify app dev`/`deploy` pushes this to the Dev Dashboard — you don't set scopes by clicking anywhere, the toml is the source of truth.

`read_orders` only returns the last 60 days of order history. For full history, you need `read_all_orders` too, which requires approval (not just adding the string):

**Dev Dashboard → Apps → [your app] → API access → Access requests → Read all orders → Request access** — describe the app and why you need full order history. It's a review queue, not instant, so apply early. Once approved, add `read_all_orders` alongside `read_orders` in the toml and redeploy.

## 6. Protected customer data — do this before recruiting beta merchants

This is separate from scopes and easy to miss until it blocks you. Order data (totals, line items, shipping events — most of what this app is built around) counts as **protected customer data**. On a development store, you get it automatically with no approval needed, which is why local testing will work fine and give no warning that anything's missing. On any real store, it's redacted by default until you're approved.

**Dev Dashboard → Apps → [your app] → API access requests** → select the customer data types and fields you actually use, describe your use case, submit for review.

Two consequences worth planning around:

- **This blocks your beta, not just your public launch.** A beta merchant installing the app on their real store will see empty or redacted order data until this is approved — worth applying for at the same time as `read_all_orders` (Section 5), not after.
- **Approval comes with real obligations**, not just a checkbox: informing merchants what data you use and why, honoring customer consent/opt-out, and — this is the one to actually act on — implementing the `customers/data_request`, `customers/redact`, and `shop/redact` webhooks. These are already stubbed as commented-out entries in `shopify.app.toml` with a note that they're not implemented yet. Given this section, treat implementing them as a beta-blocker, not a pre-launch nice-to-have — that note in the toml/README should be updated once you act on it.

## 7. Webhooks

Also declared in `shopify.app.toml`, also pushed via `shopify app deploy` — no manual dashboard step. Ledge already declares:
```
app/uninstalled, app/scopes_update, orders/create, orders/updated, orders/cancelled, refunds/create
```
One thing to know: changes to webhook subscriptions in the toml apply automatically to your dev store the moment you save while `shopify app dev` is running, but need an explicit `shopify app deploy` to take effect for any real, installed store.

## 8. Distribution method — the one you can't change later, and worth double-checking against your beta plan

**Dev Dashboard → Apps → [your app] → Distribution.** Two options, and Shopify won't let you switch afterward:

- **Public** — listed (or unlisted, i.e. installable via direct link but not searchable) on the App Store. Requires Shopify's app review.
- **Custom** — installs on one specific store, or on multiple stores *if they're all on the same Shopify Plus organization*, via a generated link. No review required.

Custom distribution is explicitly scoped to one store, or multiple stores on the same Plus organization — not multiple independent stores generally. That matters directly for the beta plan in `PLAN.md`: recruiting 2–3 unrelated AW dropshippers, each running their own independent (almost certainly non-Plus) store, doesn't fit Custom distribution's multi-store case cleanly. Some developers have reported the Dev Dashboard currently only exposes Public or Custom with no separate "unlisted, no review" option, which would mean **Public distribution with unlisted visibility, going through Shopify's review process, is the realistic path** to onboarding several independent beta merchants — not the review-free shortcut Custom distribution might suggest at first glance.

This is a genuinely recent, still-settling area of the platform (the whole custom-app model changed as of January 2026), so don't take my word as final — confirm the current options directly in your Dev Dashboard's Distribution screen before committing to a beta timeline. I've flagged this as an open question in `PLAN.md` §6 rather than quietly assuming either way.

## 9. Environment variables → where each one comes from

Maps directly to `.env.example` in the repo:

| Variable | Source |
|---|---|
| `SHOPIFY_API_KEY` | Dev Dashboard → your app → Client ID (also auto-written to `shopify.app.toml` by the CLI) |
| `SHOPIFY_API_SECRET` | Dev Dashboard → your app → Client secret |
| `SCOPES` | Whatever's in `shopify.app.toml` `[access_scopes]` — keep these in sync |
| `SHOPIFY_APP_URL` | Your Railway domain in production; managed automatically by the CLI tunnel in local dev |
| `DATABASE_URL` | Not a Shopify value — Railway's Postgres plugin "Connect" tab |

---

## Recommended order of operations

1. Partner org + dev store (Sections 1–2)
2. `npm run dev` to create/link the app, confirm install works on the dev store (Section 3)
3. Apply for `read_all_orders` **and** protected customer data access at the same time (Sections 5–6) — this is a review queue, so start the clock early even though you won't need it until real merchants install
4. Implement the three compliance webhooks (Section 6) while that review is pending
5. Deploy to Railway, update App URL / redirect URLs, run `shopify app deploy` (Section 4, 7)
6. Confirm distribution method against your actual beta plan before recruiting merchants (Section 8) — don't assume Custom distribution will cover it
7. Once approvals land: recruit beta merchants

## Further reading

- [Managing app configuration files](https://shopify.dev/docs/apps/build/cli-for-apps/manage-app-config-files)
- [Selecting a distribution method](https://shopify.dev/docs/apps/launch/distribution/select-distribution-method)
- [Working with protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data)
- [Dev Dashboard migration guide](https://shopify.dev/docs/apps/build/dev-dashboard/migrate-from-partners)
