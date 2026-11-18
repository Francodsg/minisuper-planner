import { supabase } from './supabase';
import type { CostConfig, Department, Category, ListItem, Priority, Product, Purchase, UserSettings, ShoppingList } from '@/lib/types';
import { dedupeKey, normalize } from '@/lib/search';
import type { ImportPlan, ImportRow } from '@/lib/importer';

/**
 * Capa de acceso a datos. Todas las operaciones pasan por PostgreSQL (fuente de verdad).
 * Las compras se registran con RPC atómicas e idempotentes.
 */
function check<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}

export interface Snapshot {
  settings: UserSettings | null;
  departments: Department[];
  categories: Category[];
  products: Product[];
  lists: ShoppingList[];
  items: ListItem[];
  purchases: Purchase[];
}

export async function loadAll(): Promise<Snapshot> {
  const [s, d, c, p, l, i, pu] = await Promise.all([
    supabase.from('user_settings').select('*').maybeSingle(),
    supabase.from('departments').select('*').order('sort_order').order('name'),
    supabase.from('categories').select('*').order('sort_order').order('name'),
    supabase.from('products').select('*').order('name'),
    supabase.from('shopping_lists').select('*').order('created_at'),
    supabase.from('list_items').select('*').order('added_at'),
    supabase.from('purchases').select('*').order('purchased_at'),
  ]);
  return {
    settings: check(s) as UserSettings | null,
    departments: check(d) as Department[],
    categories: check(c) as Category[],
    products: check(p) as Product[],
    lists: check(l) as ShoppingList[],
    items: check(i) as ListItem[],
    purchases: check(pu) as Purchase[],
  };
}

export async function ensureBootstrap() {
  check(await supabase.rpc('ensure_bootstrap'));
}

// ---------- Configuración ----------
export async function updateSettings(patch: Partial<UserSettings>) {
  const { data: u } = await supabase.auth.getUser();
  check(await supabase.from('user_settings').update(patch).eq('owner_id', u.user!.id));
}

// ---------- Departamentos / categorías ----------
export async function createDepartment(name: string, sort_order: number) {
  return check(await supabase.from('departments').insert({ name: name.trim(), sort_order }).select().single()) as Department;
}
export async function updateDepartment(id: string, patch: Partial<Pick<Department, 'name' | 'sort_order'>>) {
  check(await supabase.from('departments').update(patch).eq('id', id));
}
export async function deleteDepartment(id: string) {
  check(await supabase.from('departments').delete().eq('id', id));
}
export async function createCategory(department_id: string, name: string, sort_order = 0) {
  return check(await supabase.from('categories').insert({ department_id, name: name.trim(), sort_order }).select().single()) as Category;
}
export async function updateCategory(id: string, patch: Partial<Pick<Category, 'name' | 'department_id' | 'sort_order'>>) {
  check(await supabase.from('categories').update(patch).eq('id', id));
}
export async function deleteCategory(id: string, mode: 'reasignar' | 'sin_categoria' | null, target: string | null) {
  check(await supabase.rpc('delete_category', { p_category_id: id, p_mode: mode, p_target: target }));
}

// ---------- Catálogo ----------
export type ProductInput = Pick<Product, 'name' | 'brand' | 'presentation' | 'department_id' | 'category_id' | 'supplier' | 'notes'> & CostConfig;

function withKey(p: ProductInput) {
  return {
    ...p,
    name: p.name.trim(),
    brand: p.brand?.trim() || null,
    presentation: p.presentation?.trim() || null,
    supplier: p.supplier?.trim() || null,
    notes: p.notes?.trim() || null,
    dedupe_key: dedupeKey(p.name, p.brand, p.presentation),
  };
}
export async function createProduct(p: ProductInput) {
  return check(await supabase.from('products').insert(withKey(p)).select().single()) as Product;
}
export async function updateProduct(id: string, p: ProductInput) {
  return check(await supabase.from('products').update(withKey(p)).eq('id', id).select().single()) as Product;
}
export async function setProductsArchived(ids: string[], archived: boolean) {
  check(await supabase.from('products').update({ archived }).in('id', ids));
}
export async function moveProducts(ids: string[], department_id: string | null, category_id: string | null) {
  check(await supabase.from('products').update({ department_id, category_id }).in('id', ids));
}

// ---------- Planificación ----------
export type ItemInput = Pick<ListItem, 'planned_qty' | 'priority' | 'notes'> & CostConfig;

export async function addToList(list_id: string, product_id: string, input: ItemInput) {
  return check(await supabase.from('list_items').insert({ list_id, product_id, ...input }).select().single()) as ListItem;
}
export async function updateItem(id: string, patch: Partial<ItemInput>) {
  check(await supabase.from('list_items').update(patch).eq('id', id));
}
export async function setItemsPriority(ids: string[], priority: Priority) {
  check(await supabase.from('list_items').update({ priority }).in('id', ids));
}
export async function setItemsRemoved(ids: string[], removed: boolean) {
  check(await supabase.from('list_items').update({ removed_at: removed ? new Date().toISOString() : null }).in('id', ids));
}

// ---------- Compras (RPC atómicas) ----------
export interface PurchaseInput {
  quantity: number;
  unit_cost_final: string;
  purchased_at: string;
  supplier: string | null;
  notes: string | null;
}
export async function registerPurchase(list_item_id: string, p: PurchaseInput, request_id: string) {
  return check(await supabase.rpc('register_purchase', {
    p_list_item_id: list_item_id, p_quantity: p.quantity, p_unit_cost_final: p.unit_cost_final,
    p_purchased_at: p.purchased_at, p_supplier: p.supplier, p_notes: p.notes, p_request_id: request_id,
  })) as Purchase;
}
export async function correctPurchase(id: string, p: PurchaseInput) {
  return check(await supabase.rpc('correct_purchase', {
    p_purchase_id: id, p_quantity: p.quantity, p_unit_cost_final: p.unit_cost_final,
    p_purchased_at: p.purchased_at, p_supplier: p.supplier, p_notes: p.notes,
  })) as Purchase;
}
export async function voidPurchase(id: string, reason: string | null) {
  return check(await supabase.rpc('void_purchase', { p_purchase_id: id, p_reason: reason })) as Purchase;
}
export async function unvoidPurchase(id: string) {
  return check(await supabase.rpc('unvoid_purchase', { p_purchase_id: id })) as Purchase;
}

// ---------- Respaldos ----------
export async function restoreBackup(data: unknown) {
  check(await supabase.rpc('restore_backup', { p_data: data }));
}

// ---------- Importación masiva ----------

const CHUNK = 200;
async function inChunks<T, R>(items: T[], fn: (chunk: T[]) => Promise<R[]>, onProgress?: (done: number) => void): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    out.push(...(await fn(items.slice(i, i + CHUNK))));
    onProgress?.(Math.min(i + CHUNK, items.length));
  }
  return out;
}

/**
 * Ejecuta un plan de importación. Es repetible: si se interrumpe, volver a importar el
 * mismo archivo reutiliza lo ya creado y solo agrega lo que falta.
 */
export async function runImport(plan: ImportPlan, listId: string, onProgress?: (msg: string) => void): Promise<{ products: number; items: number }> {
  const snap = await loadAll();
  // 1. Departamentos
  let order = snap.departments.reduce((m, d) => Math.max(m, d.sort_order), 0);
  if (plan.newDepartments.length) {
    onProgress?.('Creando departamentos…');
    check(await supabase.from('departments').insert(plan.newDepartments.map((name) => ({ name: name.trim(), sort_order: ++order }))));
  }
  const deps = check(await supabase.from('departments').select('*')) as Department[];
  const depId = new Map(deps.map((d) => [normalize(d.name), d.id]));
  // 2. Categorías
  if (plan.newCategories.length) {
    onProgress?.('Creando categorías…');
    await inChunks(plan.newCategories, async (chunk) => {
      check(await supabase.from('categories').insert(chunk.map((c, i) => ({ department_id: depId.get(normalize(c.department)), name: c.name.trim(), sort_order: i + 1 }))));
      return [];
    });
  }
  const cats = check(await supabase.from('categories').select('*')) as Category[];
  const catId = new Map(cats.map((c) => [`${c.department_id}|${normalize(c.name)}`, c.id]));
  const classify = (r: ImportRow) => {
    const d = r.department ? depId.get(normalize(r.department)) ?? null : null;
    const c = d && r.category ? catId.get(`${d}|${normalize(r.category)}`) ?? null : null;
    return { department_id: d, category_id: c };
  };
  const cost = (r: ImportRow) => ({ unit_cost: r.cost, price_mode: 'con_impuestos' as const, iva_kind: 'tasa' as const, iva_rate: 16, ieps_kind: 'no_aplica' as const, ieps_value: 0 });
  // 3. Productos nuevos del catálogo
  const created = await inChunks(plan.newProducts, async (chunk) => check(await supabase.from('products').insert(chunk.map((r) => ({
    name: r.name.trim(), brand: r.brand || null, presentation: r.presentation || null, supplier: r.supplier || null,
    notes: null, dedupe_key: dedupeKey(r.name, r.brand, r.presentation), ...classify(r), ...cost(r),
  }))).select('id, dedupe_key')) as Array<{ id: string; dedupe_key: string }>,
  (n) => onProgress?.(`Creando productos… ${n} de ${plan.newProducts.length}`));
  const idByKey = new Map(created.map((p) => [p.dedupe_key, p.id]));
  // 4. Artículos de la lista
  const toList = [
    ...plan.newProducts.map((r) => ({ r, pid: idByKey.get(dedupeKey(r.name, r.brand, r.presentation))! })),
    ...plan.reuseProducts.map(({ row, product }) => ({ r: row, pid: product.id })),
  ];
  await inChunks(toList, async (chunk) => {
    check(await supabase.from('list_items').insert(chunk.map(({ r, pid }) => ({
      list_id: listId, product_id: pid, planned_qty: r.qty, priority: r.priority, notes: r.notes || null, ...cost(r),
    }))));
    return [];
  }, (n) => onProgress?.(`Agregando a la lista… ${n} de ${toList.length}`));
  return { products: created.length, items: toList.length };
}
