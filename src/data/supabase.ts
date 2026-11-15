import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && key);

export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 10 } },
});

/** Convierte errores de Supabase/Postgres en mensajes legibles. */
export function friendlyError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/duplicate key.*products_owner_dedupe/i.test(msg)) return 'Ya existe un producto activo con el mismo nombre, marca y presentación.';
  if (/duplicate key.*list_items_active/i.test(msg)) return 'Este producto ya está en la lista de compras.';
  if (/duplicate key.*categories_owner/i.test(msg)) return 'Ya existe una categoría con ese nombre en el departamento.';
  if (/duplicate key.*departments_owner/i.test(msg)) return 'Ya existe un departamento con ese nombre.';
  if (/violates foreign key.*departments|categories_department_id_fkey/i.test(msg)) return 'El departamento tiene categorías o productos asociados.';
  if (/violates foreign key.*products_category/i.test(msg)) return 'La categoría tiene productos asociados.';
  if (/violates foreign key.*list_items_product/i.test(msg)) return 'El producto está o estuvo en la planificación; archívalo en lugar de eliminarlo.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Sin conexión con el servidor. Revisa tu internet e inténtalo de nuevo.';
  return msg;
}
