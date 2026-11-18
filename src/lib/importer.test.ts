import { describe, it, expect } from 'vitest';
import { parseCsv, parseImport, planImport } from './importer';
import type { Department, Product } from './types';

describe('importador CSV', () => {
  it('parsea comillas, comas internas, BOM y punto y coma', () => {
    expect(parseCsv('﻿a,b\n"x, y","di ""hola"""\n')).toEqual([['a', 'b'], ['x, y', 'di "hola"']]);
    expect(parseCsv('a;b\r\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('valida filas y acepta alias de encabezados y prioridades', () => {
    const r = parseImport('Producto exacto,Cantidad,Prioridad,Unidad / tamaño,Costo unitario\nArroz,18,Apertura,1 kg,25.50\nFrijol,0,Alta,,\nSal,3,Urgente,,\nAzúcar,2,,,\n');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ name: 'Arroz', qty: 18, priority: 'alta', presentation: '1 kg', cost: '25.5' });
    expect(r.rows[1].priority).toBe('media');
    expect(r.errors).toHaveLength(2);
  });
  it('planifica: reutiliza departamentos, detecta duplicados y lo ya importado', () => {
    const now = '2026-01-01';
    const deps = [{ id: 'd1', name: 'Abarrotes' } as Department];
    const existing = { id: 'p1', name: 'Arroz', dedupe_key: 'arroz||1 kg', archived: false } as Product;
    const rows = parseImport('Departamento,Categoría,Producto,Presentación,Cantidad\nABARROTES,Granos,Arroz,1 kg,5\nLimpieza,Cloros,Cloro,1 L,3\nLimpieza,Cloros,cloro,1 l,2\n').rows;
    const plan = planImport(rows, { departments: deps, categories: [], products: [existing], items: [{ id: 'i1', product_id: 'p1', removed_at: null, added_at: now } as never] });
    expect(plan.alreadyInList).toHaveLength(1);
    expect(plan.newDepartments).toEqual(['Limpieza']);
    expect(plan.newCategories).toEqual([{ department: 'Limpieza', name: 'Cloros' }]);
    expect(plan.newProducts.map((r) => r.name)).toEqual(['Cloro']);
    expect(plan.duplicatedInFile).toHaveLength(1);
  });
});
