/**
 * Core financial engine — P&L, VAT, margin, KPIs.
 * Originally ported from the original Tatsatiti Ledger; cost-side inputs were
 * later switched from AW invoice PDFs to AW's bulk order-cost ledger export
 * (AwOrderCost) as the primary source — see PLAN.md and prisma/schema.prisma.
 * Pure functions over arrays already fetched from Postgres via Prisma —
 * no DB calls in here, so this stays easy to unit test.
 */

import { monthKey, monthLabel, type ResolvedRange, inRange } from "./dates";

// Minimal shape this module needs — matches the Prisma `Order` model (see
// prisma/schema.prisma) without forcing a hard dependency on generated Prisma
// types, so these functions stay easy to unit test with plain objects.
export interface LedgerOrder {
  total: number;
  refundedAmount: number;
  taxes: number;
  subtotal: number;
  shipping: number;
  paidAt: Date | null;
  createdAt: Date;
  cancelledAt: Date | null;
  email: string | null;
}

// Matches the Prisma `AwOrderCost` model — one row per AW order-ledger entry.
export interface LedgerAwCost {
  total: number | null;
  tax: number | null;
  net: number | null;
  date: Date | null;
  status: string | null;
}

export function getOrderDate(o: LedgerOrder): Date | null {
  return o.paidAt || o.createdAt;
}
export function getAwCostDate(c: LedgerAwCost): Date | null {
  return c.date;
}

export function activeOrders<T extends { cancelledAt: Date | null }>(orders: T[]): T[] {
  return orders.filter((o) => !o.cancelledAt);
}

/** Excludes AW ledger rows for orders AW itself cancelled — a cancelled
 *  fulfillment never actually cost anything, so it shouldn't count as COGS. */
export function activeAwCosts<T extends { status: string | null }>(costs: T[]): T[] {
  return costs.filter((c) => (c.status || "").toLowerCase() !== "cancelled");
}

export function filterOrders(orders: LedgerOrder[], range: ResolvedRange): LedgerOrder[] {
  return orders.filter((o) => inRange(getOrderDate(o), range));
}
export function filterAwCosts(costs: LedgerAwCost[], range: ResolvedRange): LedgerAwCost[] {
  return costs.filter((c) => inRange(getAwCostDate(c), range));
}

export interface KPIs {
  revenue: number;
  ordersCount: number;
  aov: number;
  cogs: number;
  grossProfit: number;
  margin: number | null;
  inputVAT: number;
  uniqueCustomers: number;
  awCostRowCount: number;
}

export function computeKPIs(orders: LedgerOrder[], awCosts: LedgerAwCost[], range: ResolvedRange): KPIs {
  const ords = filterOrders(activeOrders(orders), range);
  const costs = filterAwCosts(activeAwCosts(awCosts), range);
  const revenue = ords.reduce((s, o) => s + (o.total || 0) - (o.refundedAmount || 0), 0);
  const ordersCount = ords.length;
  const aov = ordersCount ? revenue / ordersCount : 0;
  const cogs = costs.reduce((s, c) => s + (c.total || 0), 0);
  const grossProfit = revenue - cogs;
  const margin = revenue ? (grossProfit / revenue) * 100 : null;
  const inputVAT = costs.reduce((s, c) => s + (c.tax || 0), 0);
  const uniqueCustomers = new Set(ords.map((o) => (o.email || "").toLowerCase())).size;
  return { revenue, ordersCount, aov, cogs, grossProfit, margin, inputVAT, uniqueCustomers, awCostRowCount: costs.length };
}

export interface MonthlyPoint {
  key: string;
  label: string;
  revenue: number;
  cogs: number;
  orders: number;
  profit: number;
}

export function monthlySeries(orders: LedgerOrder[], awCosts: LedgerAwCost[]): MonthlyPoint[] {
  const map: Record<string, { revenue: number; cogs: number; orders: number }> = {};
  activeOrders(orders).forEach((o) => {
    const k = monthKey(getOrderDate(o));
    map[k] = map[k] || { revenue: 0, cogs: 0, orders: 0 };
    map[k].revenue += (o.total || 0) - (o.refundedAmount || 0);
    map[k].orders += 1;
  });
  activeAwCosts(awCosts).forEach((c) => {
    const k = monthKey(getAwCostDate(c));
    map[k] = map[k] || { revenue: 0, cogs: 0, orders: 0 };
    map[k].cogs += c.total || 0;
  });
  const keys = Object.keys(map).filter((k) => k !== "unknown").sort();
  return keys.map((k) => ({
    key: k,
    label: monthLabel(k),
    revenue: map[k].revenue,
    cogs: map[k].cogs,
    orders: map[k].orders,
    profit: map[k].revenue - map[k].cogs,
  }));
}

export interface VATReturn {
  outputVAT: number;
  inputVAT: number;
  netVATdue: number;
  box6: number; // total value of sales excl. VAT
  box7: number; // total value of purchases excl. VAT
  orderCount: number;
  awCostRowCount: number;
}

export function computeVATReturn(orders: LedgerOrder[], awCosts: LedgerAwCost[], range: ResolvedRange): VATReturn {
  const ords = filterOrders(activeOrders(orders), range);
  const costs = filterAwCosts(activeAwCosts(awCosts), range);
  const outputVAT = ords.reduce((s, o) => s + (o.taxes || 0), 0);
  const inputVAT = costs.reduce((s, c) => s + (c.tax || 0), 0);
  const netVATdue = outputVAT - inputVAT;
  const box6 = ords.reduce((s, o) => s + (o.subtotal || 0) + (o.shipping || 0), 0);
  const box7 = costs.reduce((s, c) => s + (c.net || 0), 0);
  return { outputVAT, inputVAT, netVATdue, box6, box7, orderCount: ords.length, awCostRowCount: costs.length };
}

export interface PLRow {
  key: string;
  label: string;
  revenue: number;
  cogs: number;
  profit: number;
}

export interface PL {
  revenue: number;
  cogs: number;
  grossProfit: number;
  marginPct: number | null;
  rows: PLRow[];
  orderCount: number;
  awCostRowCount: number;
}

export function computePL(orders: LedgerOrder[], awCosts: LedgerAwCost[], range: ResolvedRange): PL {
  const ords = filterOrders(activeOrders(orders), range);
  const costs = filterAwCosts(activeAwCosts(awCosts), range);
  const revenue = ords.reduce((s, o) => s + (o.total || 0) - (o.refundedAmount || 0), 0);
  const cogs = costs.reduce((s, c) => s + (c.total || 0), 0);
  const grossProfit = revenue - cogs;
  const marginPct = revenue ? (grossProfit / revenue) * 100 : null;

  const monthMap: Record<string, { revenue: number; cogs: number }> = {};
  ords.forEach((o) => {
    const k = monthKey(getOrderDate(o));
    monthMap[k] = monthMap[k] || { revenue: 0, cogs: 0 };
    monthMap[k].revenue += (o.total || 0) - (o.refundedAmount || 0);
  });
  costs.forEach((c) => {
    const k = monthKey(getAwCostDate(c));
    monthMap[k] = monthMap[k] || { revenue: 0, cogs: 0 };
    monthMap[k].cogs += c.total || 0;
  });
  const rows = Object.keys(monthMap)
    .filter((k) => k !== "unknown")
    .sort()
    .map((k) => ({ key: k, label: monthLabel(k), revenue: monthMap[k].revenue, cogs: monthMap[k].cogs, profit: monthMap[k].revenue - monthMap[k].cogs }));

  return { revenue, cogs, grossProfit, marginPct, rows, orderCount: ords.length, awCostRowCount: costs.length };
}
