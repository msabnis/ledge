# TODO — Path to a real store

A working checklist, not a narrative doc — check items off as we go, add notes inline if something's blocked, don't let it go stale. For the "how" behind any of these, see `SHOPIFY_SETUP.md` (Shopify config) or `README.md` (Railway/local setup); this file is just the tracker.

*Last updated: 1 Aug 2026*

---

## Phase 1 — Get it running on your own real store

Do these roughly in order — the first two are review-queue submissions, so kick them off before anything else so the wait runs in parallel with the deploy work, not after it.

- [ ] Apply for **protected customer data access** (Dev Dashboard → your app → API access requests) — see `SHOPIFY_SETUP.md` Section 6. Without this, order data comes back empty/redacted on any real store.
- [ ] Apply for **`read_all_orders`** scope approval (same Dev Dashboard area, Section 5) — bundle with the above, same review wait either way.
- [ ] **Deploy to Railway** for the first time
  - [ ] Create Railway project, add the Postgres plugin
  - [ ] Set env vars: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `SHOPIFY_APP_URL`, `DATABASE_URL`
  - [ ] Connect the GitHub repo, confirm auto-deploy fires on push to `main`
  - [ ] Confirm the build actually succeeds — `docker-start` runs `prisma migrate deploy` automatically, so this also validates our migrations against a real fresh Postgres for the first time
- [ ] Update **App URL** + **redirect URLs** in the Dev Dashboard to the real Railway domain
- [ ] Run `shopify app deploy` locally to push current config (scopes, webhooks, URLs) live
- [ ] Install the app on your **real production store**
- [ ] Settings → Danger zone → reset & resync — confirm real order history pulls in correctly
- [ ] Upload your current real AW ledger export, check the Purchases page — do rows actually show **Linked**? This is the one thing dev-store testing couldn't prove, all session.

## Phase 2 — Ready for other people to install it

- [ ] Implement the 3 GDPR compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) — currently just stubbed/commented out in `shopify.app.toml`
- [ ] Decide distribution method — Custom vs. Public+Unlisted, still unresolved (`SHOPIFY_SETUP.md` Section 8)
- [ ] Pick an app name — neutral, no "AW" branding (`PLAN.md` open questions)
- [ ] If going Public distribution: submit for Shopify's app review

## Phase 3 — Beta

- [ ] Identify 2–3 candidate beta merchants from the AW seller community — worth re-verifying this community actually exists/is reachable before counting on it (flagged earlier, never confirmed)
- [ ] Decide beta pricing (likely free) vs. when to introduce Shopify Billing
- [ ] Recruit and onboard

## Not blocking — revisit later

Stage 2 roadmap (EU expansion, enhanced customer/business intelligence) lives in `PLAN.md` Section 5 — nothing here until the above phases are done.

---

## Changelog

- **1 Aug 2026** — Created, seeded from the "is it time for a real store" discussion.
