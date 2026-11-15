import { describe, it, expect } from 'vitest';
import { buildRows, budgetSummary, statusOf } from './budget';
import { applyFilters, DEFAULT_FILTERS } from './filters';
import type { ListItem, Product, Purchase } from './types';

const now = '2026-11-15T10:00:00Z';
const product = (id: string, name: string): Product => ({
  id, owner_id: 'u', name, brand: null, presentation: null, department_id: null, category_id: null, supplier: null,
  unit_cost: null, price_mode: 'con_impuestos', iva_kind: 'tasa', iva_rate: 16, ieps_kind: 'no_aplica', ieps_value: 0,
  notes: null, dedupe_key: name, archived: false, created_at: now, updated_at: now,
});
const item = (id: string, productId: string, qty: number, cost: string | null, priority: ListItem['priority'] = 'alta'): ListItem => ({
  id, owner_id: 'u', list_id: 'l', product_id: productId, planned_qty: qty, priority, unit_cost: cost,
  price_mode: 'con_impuestos', iva_kind: 'tasa', iva_rate: 16, ieps_kind: 'no_aplica', ieps_value: 0,
  notes: null, removed_at: null, added_at: now, updated_at: now,
});
const purchase = (id: string, itemId: string, qty: number, unit: string, voided = false): Purchase => ({
  id, owner_id: 'u', list_item_id: itemId, quantity: qty, unit_cost_final: unit,
  total: (Math.round(qty * Number(unit) * 100) / 100).toFixed(2), purchased_at: now, supplier: null, notes: null,
  request_id: id, voided_at: voided ? now : null, void_reason: null, created_at: now, updated_at: now,
});

describe('estado de compra', () => {
  it('pendiente / parcial / completado', () => {
    expect(statusOf(20, 0)).toBe('pendiente');
    expect(statusOf(20, 12)).toBe('parcial');
    expect(statusOf(20, 20)).toBe('completado');
  });
});

describe('compras parciales (ejemplo 20 pzas)', () => {
  const products = [product('p1', 'Aceite vegetal 1 L')];
  it('12 de 20 → parcial con 8 pendientes; luego 8 → completado', () => {
    let rows = buildRows([item('i1', 'p1', 20, '40.00')], products, [], [], [purchase('a', 'i1', 12, '38.50')]);
    expect(rows[0].bought).toBe(12);
    expect(rows[0].pending).toBe(8);
    expect(rows[0].status).toBe('parcial');
    expect(applyFilters(rows, DEFAULT_FILTERS)).toHaveLength(1);
    rows = buildRows([item('i1', 'p1', 20, '40.00')], products, [], [], [purchase('a', 'i1', 12, '38.50'), purchase('b', 'i1', 8, '39.00')]);
    expect(rows[0].status).toBe('completado');
    expect(rows[0].pending).toBe(0);
    expect(applyFilters(rows, DEFAULT_FILTERS)).toHaveLength(0);
    expect(rows[0].spent.toFixed(2)).toBe('774.00'); // 462 + 312
  });
  it('los movimientos revertidos no cuentan', () => {
    const rows = buildRows([item('i1', 'p1', 20, '40.00')], products, [], [], [purchase('a', 'i1', 12, '38.50', true)]);
    expect(rows[0].bought).toBe(0);
  });
});

describe('presupuesto', () => {
  const products = [product('p1', 'A'), product('p2', 'B'), product('p3', 'C')];
  const items = [item('i1', 'p1', 10, '10.00', 'alta'), item('i2', 'p2', 5, null, 'media'), item('i3', 'p3', 4, '25.00', 'baja')];
  const purchases = [purchase('x', 'i1', 4, '11.00')];
  const rows = buildRows(items, products, [], [], purchases);

  it('distingue gastado, pendiente, proyectado y saldos', () => {
    const s = budgetSummary(rows, '200');
    expect(s.spent.toFixed(2)).toBe('44.00');
    expect(s.pendingCost.toFixed(2)).toBe('160.00'); // 6*10 + 4*25
    expect(s.projected.toFixed(2)).toBe('204.00');
    expect(s.balanceAfterSpent.toFixed(2)).toBe('156.00');
    expect(s.projectedAvailable.toFixed(2)).toBe('-4.00');
    expect(s.overBudget.toFixed(2)).toBe('4.00');
    expect(s.level).toBe('excedido');
    expect(s.unknownCostCount).toBe(1);
  });
  it('umbrales de aviso', () => {
    expect(budgetSummary(rows, '240').level).toBe('aviso1'); // 85%
    expect(budgetSummary(rows, '220').level).toBe('aviso2'); // 92.7%
    expect(budgetSummary(rows, '1000').level).toBe('ok');
  });
  it('subtotales por prioridad', () => {
    const s = budgetSummary(rows, '200');
    expect(s.byPriority.alta.projected.toFixed(2)).toBe('104.00');
    expect(s.byPriority.media.unknownCostCount).toBe(1);
    expect(s.byPriority.baja.pendingCost.toFixed(2)).toBe('100.00');
  });
});
