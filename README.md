# Ledge

A Shopify app for AW Dropship sellers — reconciling Shopify sales against AW supplier costs to show true margin, P&L, and VAT position.

## Status

Pre-scaffold. Nothing built yet. See `PLAN.md` for the full project plan (strategy, MVP scope, Stage 2 roadmap) — keep that file updated as decisions get made.

## Structure

- `PLAN.md` — living project plan, update as we go
- `reference/tatsatiti-ledger-original.html` — the original single-tenant, browser-based ledger tool this project is built from. Kept for reference: P&L/VAT/margin calculation logic and the AW invoice parser in here will be ported into the real app near-verbatim. Not part of the shipped app.

## Next up

Scaffold the actual app: Shopify CLI Remix template, Prisma + Postgres, deployed on Railway. See `PLAN.md` Section 4 for the build order.
