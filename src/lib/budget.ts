import { type Dec, ZERO, dec, sum, percent } from './money';
import { finalUnitCost } from './tax';
import type { Category, Department, ListItem, Priority, Product, Purchase, PurchaseStatus } from './types';
import { PRIORITIES } from './types';

/** Fila calculada de la planificación (artículo + producto + compras). */
export interface PlanRow {
  item: ListItem;
  product: Product;
  department: Department | null;
  category: Category | null;
  purchases: Purchase[]; // solo movimientos vigentes (no revertidos)
  planned: number;
  bought: number;
  pending: number;
  status: PurchaseStatus;
  unitFinal: Dec | null; // costo estimado final por pieza (null = desconocido)
  pendingCost: Dec | null; // null si el costo es desconocido y hay piezas pendientes
  spent: Dec;
  progress: number; // 0-100
  lastPurchaseAt: string | null;
}

export function statusOf(planned: number, bought: number): PurchaseStatus {
  if (bought <= 0) return 'pendiente';
  if (bought >= planned) return 'completado';
  return 'parcial';
}

export function buildRows(
  items: ListItem[],
  products: Product[],
  departments: Department[],
  categories: Category[],
  purchases: Purchase[],
): PlanRow[] {
  const pMap = new Map(products.map((p) => [p.id, p]));
  const dMap = new Map(departments.map((d) => [d.id, d]));
  const cMap = new Map(categories.map((c) => [c.id, c]));
  const byItem = new Map<string, Purchase[]>();
  for (const pu of purchases) {
    if (pu.voided_at) continue;
    const arr = byItem.get(pu.list_item_id) ?? [];
    arr.push(pu);
    byItem.set(pu.list_item_id, arr);
  }
  const rows: PlanRow[] = [];
  for (const item of items) {
    if (item.removed_at) continue;
    const product = pMap.get(item.product_id);
    if (!product) continue;
    const ps = (byItem.get(item.id) ?? []).sort((a, b) => a.purchased_at.localeCompare(b.purchased_at));
    const bought = ps.reduce((n, p) => n + p.quantity, 0);
    const planned = item.planned_qty;
    const pending = Math.max(planned - bought, 0);
    const unitFinal = finalUnitCost(item);
    const spent = sum(ps.map((p) => dec(p.total)));
    rows.push({
      item,
      product,
      department: product.department_id ? dMap.get(product.department_id) ?? null : null,
      category: product.category_id ? cMap.get(product.category_id) ?? null : null,
      purchases: ps,
      planned,
      bought,
      pending,
      status: statusOf(planned, bought),
      unitFinal,
      pendingCost: pending === 0 ? ZERO : unitFinal ? unitFinal.times(pending) : null,
      spent,
      progress: planned > 0 ? Math.min(100, Math.round((bought / planned) * 100)) : 0,
      lastPurchaseAt: ps.length ? ps[ps.length - 1].purchased_at : null,
    });
  }
  return rows;
}

export interface Totals {
  count: number;
  spent: Dec;
  pendingCost: Dec; // solo de artículos con costo conocido
  projected: Dec;
  unknownCostCount: number; // artículos con piezas pendientes y costo desconocido
  plannedPieces: number;
  boughtPieces: number;
}

export function totalsOf(rows: PlanRow[]): Totals {
  let unknown = 0;
  const pend: Dec[] = [];
  for (const r of rows) {
    if (r.pendingCost === null) unknown++;
    else pend.push(r.pendingCost);
  }
  const spent = sum(rows.map((r) => r.spent));
  const pendingCost = sum(pend);
  return {
    count: rows.length,
    spent,
    pendingCost,
    projected: spent.plus(pendingCost),
    unknownCostCount: unknown,
    plannedPieces: rows.reduce((n, r) => n + r.planned, 0),
    boughtPieces: rows.reduce((n, r) => n + r.bought, 0),
  };
}

export type BudgetLevel = 'ok' | 'aviso1' | 'aviso2' | 'excedido' | 'sin_presupuesto';

export interface BudgetSummary extends Totals {
  budget: Dec;
  balanceAfterSpent: Dec; // presupuesto − gastado
  projectedAvailable: Dec; // presupuesto − proyectado
  overBudget: Dec; // exceso (≥ 0)
  usedPct: number; // proyectado / presupuesto
  spentPct: number;
  level: BudgetLevel;
  byPriority: Record<Priority, Totals>;
  byStatus: Record<PurchaseStatus, number>;
  progressPct: number; // piezas compradas / planificadas
}

export function budgetSummary(rows: PlanRow[], budgetMax: string | number, t1 = 80, t2 = 90): BudgetSummary {
  const totals = totalsOf(rows);
  const budget = dec(budgetMax);
  const projectedAvailable = budget.minus(totals.projected);
  const usedPct = percent(totals.projected, budget);
  let level: BudgetLevel = 'ok';
  if (budget.lte(0)) level = 'sin_presupuesto';
  else if (totals.projected.gt(budget)) level = 'excedido';
  else if (usedPct >= t2) level = 'aviso2';
  else if (usedPct >= t1) level = 'aviso1';
  const byPriority = Object.fromEntries(
    PRIORITIES.map((p) => [p, totalsOf(rows.filter((r) => r.item.priority === p))]),
  ) as Record<Priority, Totals>;
  const byStatus: Record<PurchaseStatus, number> = { pendiente: 0, parcial: 0, completado: 0 };
  for (const r of rows) byStatus[r.status]++;
  return {
    ...totals,
    budget,
    balanceAfterSpent: budget.minus(totals.spent),
    projectedAvailable,
    overBudget: projectedAvailable.lt(0) ? projectedAvailable.neg() : ZERO,
    usedPct,
    spentPct: percent(totals.spent, budget),
    level,
    byPriority,
    byStatus,
    progressPct: totals.plannedPieces > 0 ? Math.round((totals.boughtPieces / totals.plannedPieces) * 100) : 0,
  };
}

/** Subtotales por departamento. */
export function totalsByDepartment(rows: PlanRow[]): Array<{ name: string; totals: Totals }> {
  const groups = new Map<string, PlanRow[]>();
  for (const r of rows) {
    const k = r.department?.name ?? 'Sin departamento';
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([name, rs]) => ({ name, totals: totalsOf(rs) }))
    .sort((a, b) => b.totals.projected.comparedTo(a.totals.projected));
}
