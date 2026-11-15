import type { PlanRow } from './budget';
import { matchesQuery, normalize } from './search';
import type { Priority, PurchaseStatus } from './types';
import { PRIORITY_RANK } from './types';

export interface Filters {
  q: string;
  priorities: Priority[];
  departments: string[];
  categories: string[];
  statuses: PurchaseStatus[];
  cost: 'todos' | 'conocido' | 'desconocido';
}

export type SortKey = 'nombre' | 'costo' | 'prioridad' | 'cantidad' | 'departamento' | 'fecha';
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }

/** Por defecto: artículos con piezas pendientes (pendientes + parciales). */
export const DEFAULT_FILTERS: Filters = {
  q: '',
  priorities: [],
  departments: [],
  categories: [],
  statuses: ['pendiente', 'parcial'],
  cost: 'todos',
};

export function applyFilters(rows: PlanRow[], f: Filters): PlanRow[] {
  return rows.filter((r) => {
    if (f.priorities.length && !f.priorities.includes(r.item.priority)) return false;
    if (f.departments.length && !f.departments.includes(r.product.department_id ?? '')) return false;
    if (f.categories.length && !f.categories.includes(r.product.category_id ?? '')) return false;
    if (f.statuses.length && !f.statuses.includes(r.status)) return false;
    const known = r.unitFinal !== null;
    if (f.cost === 'conocido' && !known) return false;
    if (f.cost === 'desconocido' && known) return false;
    return matchesQuery(f.q, [
      r.product.name, r.product.brand, r.product.presentation, r.product.supplier,
      r.department?.name, r.category?.name,
    ]);
  });
}

export function sortRows(rows: PlanRow[], s: Sort): PlanRow[] {
  const m = s.dir === 'asc' ? 1 : -1;
  const byName = (a: PlanRow, b: PlanRow) => normalize(a.product.name).localeCompare(normalize(b.product.name), 'es');
  return [...rows].sort((a, b) => {
    let c = 0;
    switch (s.key) {
      case 'nombre': c = byName(a, b); break;
      case 'costo': {
        // desconocidos siempre al final
        if (a.pendingCost === null && b.pendingCost === null) c = 0;
        else if (a.pendingCost === null) return 1;
        else if (b.pendingCost === null) return -1;
        else c = a.pendingCost.comparedTo(b.pendingCost);
        break;
      }
      case 'prioridad': c = PRIORITY_RANK[a.item.priority] - PRIORITY_RANK[b.item.priority]; break;
      case 'cantidad': c = a.planned - b.planned; break;
      case 'departamento': c = normalize(a.department?.name).localeCompare(normalize(b.department?.name), 'es'); break;
      case 'fecha': c = a.item.added_at.localeCompare(b.item.added_at); break;
    }
    return c !== 0 ? c * m : byName(a, b);
  });
}

export function activeFilterCount(f: Filters): number {
  return (f.q ? 1 : 0) + f.priorities.length + f.departments.length + f.categories.length +
    (f.statuses.length ? 1 : 0) + (f.cost !== 'todos' ? 1 : 0);
}
