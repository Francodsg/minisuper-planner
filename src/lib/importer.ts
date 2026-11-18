import { parseMoneyInput } from './money';
import { dedupeKey, normalize } from './search';
import type { Category, Department, ListItem, Priority, Product } from './types';

/**
 * Importación masiva de productos desde CSV (Excel → "Guardar como CSV UTF-8").
 * Columnas reconocidas (encabezados sin importar mayúsculas/acentos):
 *   Producto* · Cantidad* · Prioridad · Departamento · Categoría · Marca · Presentación ·
 *   Costo unitario · Proveedor · Notas
 * La importación es repetible: los productos que ya existen se reutilizan y los que
 * ya están en la lista se omiten, así que reintentarla no duplica nada.
 */

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const delim = (src.split(/\r?\n/, 1)[0].match(/;/g)?.length ?? 0) > (src.split(/\r?\n/, 1)[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const HEADERS: Record<string, string[]> = {
  name: ['producto', 'nombre', 'producto exacto'],
  qty: ['cantidad', 'piezas', 'cantidad planificada'],
  priority: ['prioridad'],
  department: ['departamento'],
  category: ['categoria', 'subcategoria'],
  brand: ['marca'],
  presentation: ['presentacion', 'unidad', 'unidad / tamano', 'descripcion'],
  cost: ['costo unitario', 'costo', 'costo unitario mxn', 'precio'],
  supplier: ['proveedor'],
  notes: ['notas'],
};

export interface ImportRow {
  line: number;
  name: string;
  qty: number;
  priority: Priority;
  department: string;
  category: string;
  brand: string;
  presentation: string;
  cost: string | null;
  supplier: string;
  notes: string;
}

export interface ParsedImport { rows: ImportRow[]; errors: string[] }

const PRIORITY_ALIASES: Record<string, Priority> = {
  alta: 'alta', media: 'media', baja: 'baja',
  apertura: 'alta', 'al abrir': 'alta', despues: 'media', 'mucho despues': 'baja',
};

export function parseImport(text: string): ParsedImport {
  const table = parseCsv(text);
  const errors: string[] = [];
  if (table.length < 2) return { rows: [], errors: ['El archivo no tiene filas de datos.'] };
  const head = table[0].map((h) => normalize(h));
  const col = (k: string) => head.findIndex((h) => HEADERS[k].includes(h));
  const idx = Object.fromEntries(Object.keys(HEADERS).map((k) => [k, col(k)])) as Record<string, number>;
  if (idx.name < 0) return { rows: [], errors: ['Falta la columna “Producto”.'] };
  if (idx.qty < 0) return { rows: [], errors: ['Falta la columna “Cantidad”.'] };
  const get = (r: string[], k: string) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '');
  const rows: ImportRow[] = [];
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const name = get(r, 'name');
    if (!name) { errors.push(`Fila ${line}: falta el nombre del producto.`); return; }
    const qtyRaw = get(r, 'qty');
    if (!/^\d+$/.test(qtyRaw) || Number(qtyRaw) <= 0) { errors.push(`Fila ${line} (${name}): la cantidad debe ser un entero mayor a 0.`); return; }
    const pr = normalize(get(r, 'priority')) || 'media';
    const priority = PRIORITY_ALIASES[pr];
    if (!priority) { errors.push(`Fila ${line} (${name}): prioridad “${get(r, 'priority')}” no válida (usa Alta, Media o Baja).`); return; }
    const costRaw = get(r, 'cost');
    const cost = costRaw ? parseMoneyInput(costRaw) : null;
    if (costRaw && cost === null) { errors.push(`Fila ${line} (${name}): costo “${costRaw}” no válido.`); return; }
    rows.push({
      line, name, qty: Number(qtyRaw), priority, cost,
      department: get(r, 'department'), category: get(r, 'category'), brand: get(r, 'brand'),
      presentation: get(r, 'presentation'), supplier: get(r, 'supplier'), notes: get(r, 'notes'),
    });
  });
  return { rows, errors };
}

export interface ImportPlan {
  newDepartments: string[];
  newCategories: Array<{ department: string; name: string }>;
  newProducts: ImportRow[]; // se crean en el catálogo y se agregan a la lista
  reuseProducts: Array<{ row: ImportRow; product: Product }>; // ya en catálogo → solo se agregan a la lista
  alreadyInList: ImportRow[];
  duplicatedInFile: ImportRow[];
}

export function planImport(rows: ImportRow[], ctx: { departments: Department[]; categories: Category[]; products: Product[]; items: ListItem[] }): ImportPlan {
  const deptByName = new Map(ctx.departments.map((d) => [normalize(d.name), d]));
  const catKey = (dep: string, cat: string) => `${normalize(dep)}|${normalize(cat)}`;
  const deptName = new Map(ctx.departments.map((d) => [d.id, d.name]));
  const existingCats = new Set(ctx.categories.map((c) => catKey(deptName.get(c.department_id) ?? '', c.name)));
  const prodByKey = new Map(ctx.products.filter((p) => !p.archived).map((p) => [p.dedupe_key, p]));
  const inList = new Set(ctx.items.filter((i) => !i.removed_at).map((i) => i.product_id));
  const plan: ImportPlan = { newDepartments: [], newCategories: [], newProducts: [], reuseProducts: [], alreadyInList: [], duplicatedInFile: [] };
  const seenKeys = new Set<string>();
  const newDeps = new Set<string>(), newCats = new Set<string>();
  for (const r of rows) {
    const key = dedupeKey(r.name, r.brand, r.presentation);
    if (seenKeys.has(key)) { plan.duplicatedInFile.push(r); continue; }
    seenKeys.add(key);
    const existing = prodByKey.get(key);
    if (existing && inList.has(existing.id)) { plan.alreadyInList.push(r); continue; }
    if (r.department && !deptByName.has(normalize(r.department)) && !newDeps.has(normalize(r.department))) {
      newDeps.add(normalize(r.department)); plan.newDepartments.push(r.department);
    }
    if (r.department && r.category && !existingCats.has(catKey(r.department, r.category)) && !newCats.has(catKey(r.department, r.category))) {
      newCats.add(catKey(r.department, r.category)); plan.newCategories.push({ department: r.department, name: r.category });
    }
    if (existing) plan.reuseProducts.push({ row: r, product: existing });
    else plan.newProducts.push(r);
  }
  return plan;
}
