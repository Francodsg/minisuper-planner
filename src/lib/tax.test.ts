import { describe, it, expect } from 'vitest';
import { computeTaxes, finalUnitCost } from './tax';
import type { CostConfig } from './types';

const base: CostConfig = { unit_cost: null, price_mode: 'antes_impuestos', iva_kind: 'tasa', iva_rate: 16, ieps_kind: 'no_aplica', ieps_value: 0 };

describe('computeTaxes', () => {
  it('costo desconocido no se trata como cero', () => {
    expect(computeTaxes(base).known).toBe(false);
    expect(finalUnitCost(base)).toBeNull();
  });
  it('costo explícito de $0 es conocido', () => {
    expect(finalUnitCost({ ...base, unit_cost: 0 })?.toFixed(2)).toBe('0.00');
  });
  it('antes de impuestos + IVA 16%', () => {
    const t = computeTaxes({ ...base, unit_cost: '100' });
    expect(t.iva.toFixed(2)).toBe('16.00');
    expect(t.final.toFixed(2)).toBe('116.00');
  });
  it('IEPS porcentual forma parte de la base del IVA', () => {
    // 100 + IEPS 8% = 108; IVA 16% de 108 = 17.28; final 125.28
    const t = computeTaxes({ ...base, unit_cost: '100', ieps_kind: 'porcentaje', ieps_value: 8 });
    expect(t.ieps.toFixed(2)).toBe('8.00');
    expect(t.iva.toFixed(2)).toBe('17.28');
    expect(t.final.toFixed(2)).toBe('125.28');
  });
  it('IEPS cuota fija por pieza', () => {
    const t = computeTaxes({ ...base, unit_cost: '20', ieps_kind: 'cuota_fija', ieps_value: '1.5' });
    expect(t.final.toFixed(2)).toBe('24.94'); // (20+1.5)*1.16 = 24.94
  });
  it('precio final con impuestos: no duplica impuestos y desglosa', () => {
    const t = computeTaxes({ ...base, price_mode: 'con_impuestos', unit_cost: '125.28', ieps_kind: 'porcentaje', ieps_value: 8 });
    expect(t.final.toFixed(2)).toBe('125.28');
    expect(t.iva.toFixed(2)).toBe('17.28');
    expect(t.ieps.toFixed(2)).toBe('8.00');
    expect(t.base.toFixed(2)).toBe('100.00');
    expect(t.base.plus(t.ieps).plus(t.iva).toFixed(2)).toBe('125.28');
  });
  it('exento y tasa cero no agregan IVA', () => {
    expect(finalUnitCost({ ...base, unit_cost: '50', iva_kind: 'exento' })?.toFixed(2)).toBe('50.00');
    expect(finalUnitCost({ ...base, unit_cost: '50', iva_kind: 'tasa_cero' })?.toFixed(2)).toBe('50.00');
  });
  it('evita errores de coma flotante', () => {
    // 0.1 + 0.2 en float = 0.30000000000000004
    const t = computeTaxes({ ...base, unit_cost: '0.10', iva_kind: 'exento' });
    expect(t.final.plus('0.2').toFixed(2)).toBe('0.30');
  });
  it('redondeo mitad hacia arriba', () => {
    // 10.125 * 1.16 → base se redondea a 10.13; IVA 1.6208→1.62; final 11.75
    expect(finalUnitCost({ ...base, unit_cost: '10.125' })?.toFixed(2)).toBe('11.75');
  });
});
