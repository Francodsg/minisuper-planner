import type { Snapshot } from '@/data/api';
import type { PlanRow } from './budget';
import { formatMXN } from './money';
import { PRIORITY_LABEL, STATUS_LABEL } from './types';

export const BACKUP_VERSION = 1;

export function buildBackup(s: Snapshot) {
  return {
    app: 'minisuper-planner',
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    settings: s.settings ? {
      budget_max: s.settings.budget_max,
      warn_threshold_1: s.settings.warn_threshold_1,
      warn_threshold_2: s.settings.warn_threshold_2,
      backup_reminder_days: s.settings.backup_reminder_days,
    } : null,
    departments: s.departments,
    categories: s.categories,
    products: s.products,
    shopping_lists: s.lists,
    list_items: s.items,
    purchases: s.purchases.map(({ total: _t, ...p }) => p), // total es columna calculada
  };
}

export interface BackupCheck { ok: boolean; error?: string; counts?: Record<string, number> }

export function validateBackup(raw: unknown): BackupCheck {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'El archivo no contiene JSON válido.' };
  const b = raw as Record<string, unknown>;
  if (b.app !== 'minisuper-planner') return { ok: false, error: 'El archivo no es un respaldo de MiniSúper Planner.' };
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) return { ok: false, error: 'Versión de respaldo no compatible.' };
  const keys = ['departments', 'categories', 'products', 'shopping_lists', 'list_items', 'purchases'];
  const counts: Record<string, number> = {};
  for (const k of keys) {
    if (!Array.isArray(b[k])) return { ok: false, error: `Falta la sección “${k}”.` };
    counts[k] = (b[k] as unknown[]).length;
  }
  return { ok: true, counts };
}

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV compatible con Excel (UTF-8 con BOM; importes como número con punto decimal). */
export function rowsToCsv(rows: PlanRow[]): string {
  const header = ['Producto', 'Marca', 'Presentación', 'Departamento', 'Categoría', 'Prioridad', 'Estado', 'Planificadas', 'Compradas', 'Pendientes',
    'Costo unitario estimado (con impuestos)', 'Costo pendiente', 'Gastado', 'Proveedor', 'Notas'];
  const lines = rows.map((r) => [
    r.product.name, r.product.brand, r.product.presentation, r.department?.name, r.category?.name,
    PRIORITY_LABEL[r.item.priority], STATUS_LABEL[r.status], r.planned, r.bought, r.pending,
    r.unitFinal ? r.unitFinal.toFixed(2) : 'Sin costo', r.pendingCost ? r.pendingCost.toFixed(2) : r.pending ? 'Sin costo' : '0.00',
    r.spent.toFixed(2), r.product.supplier, r.item.notes ?? r.product.notes,
  ].map(csvCell).join(','));
  return '﻿' + [header.map(csvCell).join(','), ...lines].join('\r\n');
}

export function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fmt = formatMXN;
