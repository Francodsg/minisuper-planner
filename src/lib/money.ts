import Decimal from 'decimal.js';

/**
 * POLÍTICA DE REDONDEO (documentada)
 * - Toda la aritmética monetaria usa decimal.js (base 10), nunca number/float.
 * - Los importes se almacenan y muestran con 2 decimales (centavos).
 * - Redondeo: "mitad hacia arriba" (ROUND_HALF_UP), el usual en comprobantes en México.
 * - Costo final unitario: se redondea a centavos una sola vez por pieza.
 * - Importe de una línea = costo final unitario (ya redondeado) × piezas → exacto en centavos.
 * - Los totales son sumas de importes de línea ya redondeados (no se re-redondea).
 */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

export const ZERO = new D(0);

export function dec(value: string | number | null | undefined | Dec): Dec {
  if (value === null || value === undefined || value === '') return ZERO;
  if (value instanceof D) return value;
  return new D(value as string | number);
}

export function round2(value: Dec): Dec {
  return value.toDecimalPlaces(2, D.ROUND_HALF_UP);
}

export function isKnown(value: string | number | null | undefined): boolean {
  return value !== null && value !== undefined && value !== '';
}

const mxn = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formatea un importe en MXN con 2 decimales (p. ej. "$1,234.50"). */
export function formatMXN(value: Dec | string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  // Intl recibe el string ya redondeado para no introducir errores de coma flotante
  return mxn.format(Number(round2(dec(value)).toFixed(2)));
}

/** Convierte texto capturado ("1,234.5", "$ 10") a string decimal normalizado o null. */
export function parseMoneyInput(raw: string): string | null {
  const cleaned = raw.replace(/[$\s,]/g, '').trim();
  if (cleaned === '') return null;
  if (!/^\d+(\.\d{0,4})?$/.test(cleaned)) return null;
  return new D(cleaned).toFixed();
}

export function sum(values: Dec[]): Dec {
  return values.reduce((acc, v) => acc.plus(v), ZERO);
}

export function percent(part: Dec, whole: Dec): number {
  if (whole.lte(0)) return 0;
  return Number(part.div(whole).times(100).toDecimalPlaces(1).toFixed(1));
}
