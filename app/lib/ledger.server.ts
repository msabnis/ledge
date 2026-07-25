/**
 * Core financial engine — P&L, VAT, margin, KPIs.
 * Ported near-verbatim from the original Tatsatiti Ledger
 * (see /reference/tatsatiti-ledger-original.html, lines ~606-712).
 * Pure functions over arrays already fetched from Postgres via Prisma —
 * no DB calls in here, so this stays easy to unit test.
 */

import { monthKey, monthLabel, type ResolvedRange, inRange } from "./dates";

// Minimal shape this module needs — matches the Prisma `Order` / `SupplierInvoice`
// models (see prisma/schema.prisma) without forcing a hard dependency on
// generated Prisma types, so these functions stay easy to unit test with plain objects.
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

export interface LedgerInvoice {
  type: string; // "invoice" | "refund"
  total: number | null;
  vat: number | null;
  totalNet: number | null;
  date: Date | null;
}

export function getOrderDate(o: LedgerOrder): Date | null {
  return o.paidAt || o.createdAt;
}
export function getInvoiceDate(inv: LedgerInvoice): Date | null {
  return inv.date;
}

export function activeOrders<T extends { cancelledAt: Date | null }>(orders: T[]): T[] {
  return orders.filter((o) => !o.cancelledAt);
}

export function filterOrders(orders: LedgerOrder[], range: ResolvedRange): LedgerOrder[] {
  return orders.filter((o) => inRange(getOrderDate(o), range));
}
export function filterInvoices(invoices: LedgerInvoice[], range: ResolvedRange): LedgerInvoice[] {
  return invoices.filter((i) => inRange(getInvoiceDate(i), range));
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
  invoiceCount: number;
  refunds: number;
}

export function computeKPIs(orders: LedgerOrder[], invoices: LedgerInvoice[], range: ResolvedRange): KPIs {
  const ords = filterOrders(activeOrders(orders), range);
  const invs = filterInvoices(invoices, range);
  const revenue = ords.reduce((s, o) => s + (o.total || 0) - (o.refundedAmount || 0), 0);
  const ordersCount = ords.length;
  const aov = ordersCount ? revenue / ordersCount : 0;
  const cogs = invs.reduce((s, i) => s + (i.total || 0), 0);
  const grossProfit = revenue - cogs;
  const margin = revenue ? (grossProfit / revenue) * 100 : null;
  const inputVAT = invs.reduce((s, i) => s + (i.vat || 0), 0);
  const uniqueCustomers = new Set(ords.map((o) => (o.email || "").toLowerCase())).size;
  const refunds = invs.filter((i) => i.type === "refund").reduce((s, i) => s + Math.abs(i.total || 0), 0);
  return { revenue, ordersCount, aov, cogs, grossProfit, margin, inputVAT, uniqueCustomers, invoiceCount: invs.length, refunds };
}

export interface MonthlyPoint {
  key: string;
  label: string;
  revenue: number;
  cogs: number;
  orders: number;
  profit: number;
}

export function monthlySeries(orders: LedgerOrder[], invoices: LedgerInvoice[]): MonthlyPoint[] {
  const map: Record<string, { revenue: number; cogs: number; orders: number }> = {};
  activeOrders(orders).forEach((o) => {
    const k = monthKey(getOrderDate(o));
    map[k] = map[k] || { revenue: 0, cogs: 0, orders: 0 };
    map[k].revenue += (o.total || 0) - (o.refundedAmount || 0);
    map[k].orders += 1;
  });
  invoices.forEach((inv) => {
    const k = monthKey(getInvoiceDate(inv));
    map[k] = map[k] || { revenue: 0, cogs: 0, orders: 0 };
    map[k].cogs += inv.total || 0;
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
  invoiceCount: number;
}

export function computeVATReturn(orders: LedgerOrder[], invoices: LedgerInvoice[], range: ResolvedRange): VATReturn {
  const ords = filterOrders(activeOrders(orders), range);
  const invs = filterInvoices(invoices, range);
  const outputVAT = ords.reduce((s, o) => s + (o.taxes || 0), 0);
  const inputVAT = invs.reduce((s, i) => s + (i.vat || 0), 0);
  const netVATdue = outputVAT - inputVAT;
  const box6 = ords.reduce((s, o) => s + (o.subtotal || 0) + (o.shipping || 0), 0);
  const box7 = invs.reduce((s, i) => s + (i.totalNet || 0), 0);
  return { outputVAT, inputVAT, netVATdue, box6, box7, orderCount: ords.length, invoiceCount: invs.length };
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
  invoiceCount: number;
}

export function computePL(orders: LedgerOrder[], invoices: LedgerInvoice[], range: ResolvedRange): PL {
  const ords = filterOrders(activeOrders(orders), range);
  const invs = filterInvoices(invoices, range);
  const revenue = ords.reduce((s, o) => s + (o.total || 0) - (o.refundedAmount || 0), 0);
  const cogs = invs.reduce((s, i) => s + (i.total || 0), 0);
  const grossProfit = revenue - cogs;
  const marginPct = revenue ? (grossProfit / revenue) * 100 : null;

  const monthMap: Record<string, { revenue: number; cogs: number }> = {};
  ords.forEach((o) => {
    const k = monthKey(getOrderDate(o));
    monthMap[k] = monthMap[k] || { revenue: 0, cogs: 0 };
    monthMap[k].revenue += (o.total || 0) - (o.refundedAmount || 0);
  });
  invs.forEach((i) => {
    const k = monthKey(getInvoiceDate(i));
    monthMap[k] = monthMap[k] || { revenue: 0, cogs: 0 };
    monthMap[k].cogs += i.total || 0;
  });
  const rows = Object.keys(monthMap)
    .filter((k) => k !== "unknown")
    .sort()
    .map((k) => ({ key: k, label: monthLabel(k), revenue: monthMap[k].revenue, cogs: monthMap[k].cogs, profit: monthMap[k].revenue - monthMap[k].cogs }));

  return { revenue, cogs, grossProfit, marginPct, rows, orderCount: ords.length, invoiceCount: invs.length };
}
