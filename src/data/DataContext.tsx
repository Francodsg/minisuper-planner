import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import { ensureBootstrap, loadAll, type Snapshot } from './api';
import { buildRows, budgetSummary, type BudgetSummary, type PlanRow } from '@/lib/budget';
import { useAuth } from './AuthContext';

interface DataState extends Snapshot {
  loading: boolean;
  error: string | null;
  online: boolean;
  rows: PlanRow[];
  summary: BudgetSummary;
  listId: string | null;
  refresh: () => Promise<void>;
}

const EMPTY: Snapshot = { settings: null, departments: [], categories: [], products: [], lists: [], items: [], purchases: [] };
const Ctx = createContext<DataState | null>(null);

/**
 * Carga todos los datos del usuario (un solo usuario, volumen moderado) y se suscribe a
 * Supabase Realtime: cualquier cambio en otro dispositivo provoca una recarga coalescida.
 * Después de cada mutación local también se recarga, por lo que los indicadores se
 * actualizan de inmediato.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const uid = session?.user.id;
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const my = ++seq.current;
    try {
      const data = await loadAll();
      if (my === seq.current) { setSnap(data); setError(null); }
    } catch (e) {
      if (my === seq.current) setError((e as Error).message ?? 'Error al cargar datos');
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try { await ensureBootstrap(); } catch { /* el trigger de alta ya lo hizo normalmente */ }
      if (!cancelled) await refresh();
    })();
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void refresh(), 150);
    };
    const channel = supabase.channel(`sync-${uid}`);
    for (const table of ['user_settings', 'departments', 'categories', 'products', 'shopping_lists', 'list_items', 'purchases']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `owner_id=eq.${uid}` }, schedule);
    }
    channel.subscribe((status) => { if (status === 'SUBSCRIBED') schedule(); });
    const onFocus = () => schedule();
    const on = () => { setOnline(true); schedule(); };
    const off = () => setOnline(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [uid, refresh]);

  const value = useMemo<DataState>(() => {
    const rows = buildRows(snap.items, snap.products, snap.departments, snap.categories, snap.purchases);
    const s = snap.settings;
    return {
      ...snap,
      loading,
      error,
      online,
      rows,
      summary: budgetSummary(rows, s?.budget_max ?? 0, s?.warn_threshold_1 ?? 80, s?.warn_threshold_2 ?? 90),
      listId: snap.lists[0]?.id ?? null,
      refresh,
    };
  }, [snap, loading, error, online, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useData fuera de DataProvider');
  return c;
}
