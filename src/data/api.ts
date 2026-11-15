import { supabase } from './supabase';
import type { CostConfig, Department, Category, ListItem, Priority, Product, Purchase, UserSettings, ShoppingList } from '@/lib/types';
import { dedupeKey } from '@/lib/search';

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
