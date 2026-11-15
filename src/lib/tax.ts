import { D, type Dec, dec, round2, ZERO, isKnown } from './money';
import type { CostConfig } from './types';

/**
 * Cálculo de impuestos para PLANIFICACIÓN (estimaciones; no sustituye asesoría fiscal).
 *
 * Orden de cálculo (México):
 *   1. Base = precio antes de impuestos.
 *   2. IEPS = base × tasa%  (o cuota fija × 1 pieza).
 *   3. Base del IVA = base + IEPS   (el IEPS forma parte de la base del IVA).
 *   4. IVA = base del IVA × tasa%   (0 si es exento o tasa cero).
 *   5. Final = base + IEPS + IVA.
 *
 * Si se captura el precio FINAL, se desglosa de forma inversa:
 *   base = (final / (1 + iva)) / (1 + ieps%)    o bien    base = final / (1 + iva) − cuota
 * El costo final capturado se respeta exactamente; las diferencias de centavos del
 * desglose se absorben en la base para que base + IEPS + IVA = final (sin duplicar impuestos).
 */
export interface TaxBreakdown {
  known: boolean;
  base: Dec;
  ieps: Dec;
  iva: Dec;
  final: Dec;
}

export function ivaRateOf(c: Pick<CostConfig, 'iva_kind' | 'iva_rate'>): Dec {
  return c.iva_kind === 'tasa' ? dec(c.iva_rate).div(100) : ZERO;
}

export function computeTaxes(c: CostConfig): TaxBreakdown {
  if (!isKnown(c.unit_cost)) return { known: false, base: ZERO, ieps: ZERO, iva: ZERO, final: ZERO };
  const amount = dec(c.unit_cost);
  const ivaRate = ivaRateOf(c);
  const iepsVal = dec(c.ieps_value);
  const iepsPct = c.ieps_kind === 'porcentaje' ? iepsVal.div(100) : ZERO;
  const iepsFixed = c.ieps_kind === 'cuota_fija' ? iepsVal : ZERO;

  if (c.price_mode === 'antes_impuestos') {
    const base = round2(amount);
    const ieps = round2(base.times(iepsPct).plus(iepsFixed));
    const iva = round2(base.plus(ieps).times(ivaRate));
    return { known: true, base, ieps, iva, final: base.plus(ieps).plus(iva) };
  }

  // Precio final con impuestos incluidos
  const final = round2(amount);
  const ivaBase = final.div(new D(1).plus(ivaRate)); // base + IEPS
  const iva = round2(final.minus(ivaBase));
  let ieps: Dec;
  if (c.ieps_kind === 'porcentaje') {
    const base = ivaBase.div(new D(1).plus(iepsPct));
    ieps = round2(ivaBase.minus(base));
  } else {
    ieps = round2(iepsFixed);
  }
  let base = final.minus(iva).minus(ieps);
  if (base.lt(0)) {
    // cuota fija mayor que el precio: configuración incoherente → no se inventan negativos
    base = ZERO;
    ieps = final.minus(iva);
  }
  return { known: true, base, ieps, iva, final };
}

/** Costo final unitario (con impuestos) o null si se desconoce. */
export function finalUnitCost(c: CostConfig): Dec | null {
  const t = computeTaxes(c);
  return t.known ? t.final : null;
}

export const TAX_DISCLAIMER =
  'Los impuestos se calculan como estimación para planificar compras. Valídalos con tu contador o con el SAT si los usarás para contabilidad.';
