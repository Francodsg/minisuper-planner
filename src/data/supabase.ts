import { createClient } from '@supabase/supabase-js';

/**
 * Normaliza la URL del proyecto: quita espacios, agrega https:// si falta y descarta
 * rutas como /rest/v1. Devuelve null si no es una URL válida.
 */
export function normalizeSupabaseUrl(raw: string | undefined): string | null {
  const v = (raw ?? '').trim().replace(/^["']|["']$/g, '');
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    return u.origin;
  } catch {
    return null;
  }
}

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const url = normalizeSupabaseUrl(rawUrl);
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim().replace(/^["']|["']$/g, '');

export const isConfigured = Boolean(url && key);
/** Explica qué falta, para mostrarlo en pantalla en lugar de una página en blanco. */
export const configProblem: string | null = !rawUrl?.trim()
  ? 'Falta VITE_SUPABASE_URL.'
  : !url
    ? `VITE_SUPABASE_URL no es una URL válida (debe verse como https://xxxx.supabase.co).`
    : !key
      ? 'Falta VITE_SUPABASE_ANON_KEY.'
      : null;

export const supabase = createClient(url ?? 'http://localhost:54321', key || 'missing-key', {
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
