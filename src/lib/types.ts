export type Priority = 'alta' | 'media' | 'baja';
export type PriceMode = 'antes_impuestos' | 'con_impuestos';
export type IvaKind = 'exento' | 'tasa_cero' | 'tasa';
export type IepsKind = 'no_aplica' | 'porcentaje' | 'cuota_fija';
export type PurchaseStatus = 'pendiente' | 'parcial' | 'completado';

/** Configuración de costo + impuestos. `unit_cost` null = costo desconocido. */
export interface CostConfig {
  unit_cost: string | number | null;
  price_mode: PriceMode;
  iva_kind: IvaKind;
  iva_rate: string | number;
  ieps_kind: IepsKind;
  ieps_value: string | number;
}

export interface UserSettings {
  owner_id: string;
  budget_max: string | number;
  warn_threshold_1: number;
  warn_threshold_2: number;
  default_view: 'auto' | 'tabla' | 'tarjetas';
  compact_rows: boolean;
  backup_reminder_days: number;
  last_backup_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Department {
  id: string;
  owner_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  owner_id: string;
  department_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Product extends CostConfig {
  id: string;
  owner_id: string;
  name: string;
  brand: string | null;
  presentation: string | null;
  department_id: string | null;
  category_id: string | null;
  supplier: string | null;
  notes: string | null;
  dedupe_key: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ShoppingList {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface ListItem extends CostConfig {
  id: string;
  owner_id: string;
  list_id: string;
  product_id: string;
  planned_qty: number;
  priority: Priority;
  notes: string | null;
  removed_at: string | null;
  added_at: string;
  updated_at: string;
}

export interface Purchase {
  id: string;
  owner_id: string;
  list_item_id: string;
  quantity: number;
  unit_cost_final: string | number;
  total: string | number;
  purchased_at: string;
  supplier: string | null;
  notes: string | null;
  request_id: string;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
}

export const PRIORITIES: Priority[] = ['alta', 'media', 'baja'];
export const PRIORITY_LABEL: Record<Priority, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' };
export const PRIORITY_RANK: Record<Priority, number> = { alta: 0, media: 1, baja: 2 };
export const STATUS_LABEL: Record<PurchaseStatus, string> = {
  pendiente: 'Pendiente',
  parcial: 'Parcialmente comprado',
  completado: 'Completado',
};
