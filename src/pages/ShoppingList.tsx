import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Archive, ArrowDownUp, Columns3, FolderInput, History, LayoutGrid, ListChecks, Pencil, Plus, Search, ShoppingBag,
  SlidersHorizontal, Table2, Trash2, X, AlertTriangle,
} from 'lucide-react';
import { useData } from '@/data/DataContext';
import * as api from '@/data/api';
import { friendlyError } from '@/data/supabase';
import type { PlanRow } from '@/lib/budget';
import { totalsOf } from '@/lib/budget';
import { activeFilterCount, applyFilters, DEFAULT_FILTERS, sortRows, type Filters, type Sort, type SortKey } from '@/lib/filters';
import { formatMXN, parseMoneyInput } from '@/lib/money';
import type { Priority, PurchaseStatus } from '@/lib/types';
import { PRIORITIES, PRIORITY_LABEL } from '@/lib/types';
import { PageHeader } from '@/components/Layout';
import { BudgetAlert } from './Dashboard';
import { useProductForm } from '@/components/ProductForm';
import { usePurchases } from '@/components/PurchaseDialog';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { Menu } from '@/components/Menu';
import { MultiSelect } from '@/components/MultiSelect';
import { ImportDialog } from '@/components/ImportDialog';
import { Button, EmptyState, Modal, PriorityBadge, ProgressBar, Skeleton, StatusBadge, cx } from '@/components/ui';

type View = 'tabla' | 'tarjetas';
const OPTIONAL_COLS = { clasificacion: 'Departamento y categoría', unitario: 'Costo unitario', proveedor: 'Proveedor' } as const;
type OptCol = keyof typeof OPTIONAL_COLS;

function readPref<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function writePref(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* preferencia no crítica */ } }

export default function ShoppingList() {
  const data = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const { open } = useProductForm();
  const purchases = usePurchases();
  const [params] = useSearchParams();

  const [filters, setFilters] = useState<Filters>(() => {
    const f = { ...DEFAULT_FILTERS };
    const pr = params.get('prioridad');
    if (pr && (PRIORITIES as string[]).includes(pr)) f.priorities = [pr as Priority];
    if (params.get('costo') === 'desconocido') f.cost = 'desconocido';
    return f;
  });
  const [sort, setSort] = useState<Sort>(() => readPref('msp.sort', { key: 'prioridad', dir: 'asc' }));
  const defaultView = data.settings?.default_view ?? 'auto';
  const [view, setView] = useState<View>(() => readPref<View | null>('msp.view', null) ??
    (defaultView === 'auto' ? (window.innerWidth < 768 ? 'tarjetas' : 'tabla') : defaultView));
  const [cols, setCols] = useState<Record<OptCol, boolean>>(() => readPref('msp.cols', { clasificacion: true, unitario: true, proveedor: false }));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => writePref('msp.sort', sort), [sort]);
  useEffect(() => writePref('msp.view', view), [view]);
  useEffect(() => writePref('msp.cols', cols), [cols]);

  // la búsqueda se calcula en segundo plano para no bloquear la escritura
  const deferredFilters = useDeferredValue(filters);
  const filtered = useMemo(() => sortRows(applyFilters(data.rows, deferredFilters), sort), [data.rows, deferredFilters, sort]);
  // con listas grandes se muestran por bloques para que la pantalla siga siendo ágil
  const PAGE = 100;
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [deferredFilters, sort]);
  const visibleRows = filtered.slice(0, shown);
  const totals = totalsOf(filtered);
  const selRows = filtered.filter((r) => selected.has(r.item.id));
  // limpia selección de artículos que ya no son visibles
  useEffect(() => {
    setSelected((s) => {
      const visible = new Set(filtered.map((r) => r.item.id));
      const next = new Set([...s].filter((id) => visible.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [filtered]);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.item.id));

  // ----- Acciones -----
  async function run(fn: () => Promise<unknown>, ok?: string, undo?: () => Promise<unknown>) {
    try {
      await fn();
      await data.refresh();
      if (ok) toast.success(ok, undo ? { label: 'Deshacer', run: async () => {
        try { await undo(); await data.refresh(); toast.info('Acción deshecha'); } catch (e) { toast.error(friendlyError(e)); }
      } } : undefined);
    } catch (e) { toast.error(friendlyError(e)); }
  }

  async function bulkPriority(p: Priority) {
    const prev = new Map<Priority, string[]>();
    for (const r of selRows) prev.set(r.item.priority, [...(prev.get(r.item.priority) ?? []), r.item.id]);
    const ids = selRows.map((r) => r.item.id);
    await run(() => api.setItemsPriority(ids, p), `Prioridad ${PRIORITY_LABEL[p].toLowerCase()} asignada a ${ids.length} artículo(s)`,
      () => Promise.all([...prev].map(([pr, xs]) => api.setItemsPriority(xs, pr))));
  }

  async function removeRows(rows: PlanRow[]) {
    const blocked = rows.filter((r) => r.bought > 0);
    const ok = rows.filter((r) => r.bought === 0);
    if (ok.length === 0) { toast.error('Los artículos con compras registradas no se pueden retirar. Revierte primero sus compras.'); return; }
    const yes = await confirm({
      title: 'Retirar de la lista de compras', danger: true, confirm: 'Retirar',
      text: <>
        <p>Se retirarán <b>{ok.length}</b> artículo(s) de la planificación. Los productos seguirán en el catálogo.</p>
        {blocked.length > 0 && <p className="mt-2 text-warning">{blocked.length} artículo(s) con compras registradas se conservarán.</p>}
      </>,
    });
    if (!yes) return;
    const ids = ok.map((r) => r.item.id);
    await run(() => api.setItemsRemoved(ids, true), `${ids.length} artículo(s) retirados de la lista`, () => api.setItemsRemoved(ids, false));
    setSelected(new Set());
  }

  async function archiveRows(rows: PlanRow[]) {
    const ok = rows.filter((r) => r.bought === 0);
    if (ok.length === 0) { toast.error('No se pueden archivar productos con compras registradas.'); return; }
    const yes = await confirm({
      title: 'Archivar productos del catálogo', danger: true, confirm: 'Archivar',
      text: <p>Se retirarán de la lista y se archivarán en el catálogo <b>{ok.length}</b> producto(s). Podrás reactivarlos desde el Catálogo.
        {ok.length < rows.length && ` ${rows.length - ok.length} con compras se conservarán.`}</p>,
    });
    if (!yes) return;
    const items = ok.map((r) => r.item.id), prods = ok.map((r) => r.product.id);
    await run(async () => { await api.setItemsRemoved(items, true); await api.setProductsArchived(prods, true); },
      `${ok.length} producto(s) archivados`,
      async () => { await api.setProductsArchived(prods, false); await api.setItemsRemoved(items, false); });
    setSelected(new Set());
  }

  const rowActions = (r: PlanRow) => [
    { label: 'Registrar compra', icon: <ShoppingBag className="size-4" />, onClick: () => purchases.register(r.item.id), disabled: r.pending === 0 },
    { label: 'Historial de compras', icon: <History className="size-4" />, onClick: () => purchases.history(r.item.id) },
    { label: 'Editar', icon: <Pencil className="size-4" />, onClick: () => open({ kind: 'editItem', item: r.item, product: r.product }) },
    { label: 'Retirar de la lista', icon: <Trash2 className="size-4" />, danger: true, onClick: () => removeRows([r]),
      disabled: r.bought > 0, hint: r.bought > 0 ? 'Tiene compras registradas: revierte primero sus compras' : undefined },
  ];

  if (data.loading) return <div className="space-y-3"><Skeleton className="h-10 w-72" /><Skeleton className="h-12" />{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14" />)}</div>;

  const nFilters = activeFilterCount(filters);
  const hasAny = data.rows.length > 0;

  return (
    <div>
      <PageHeader title="Lista de compras" description="Productos del surtido inicial. Por defecto se muestran los que aún tienen piezas pendientes."
        actions={<Button className="max-md:!hidden" icon={<Plus className="size-4" />} onClick={() => open({})}>Agregar producto</Button>} />
      <BudgetAlert />

      {/* Resumen de los resultados filtrados */}
      <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-5">
        {[
          ['Artículos', String(totals.count)],
          ['Pendiente estimado', formatMXN(totals.pendingCost)],
          ['Gastado', formatMXN(totals.spent)],
          ['Proyectado', formatMXN(totals.projected)],
          ['Sin costo', String(totals.unknownCostCount)],
        ].map(([l, v], i) => (
          <div key={l} className={cx('bg-surface px-4 py-3', i === 4 && 'col-span-2 md:col-span-1')}>
            <p className="text-xs text-muted">{l} <span className="hidden md:inline">(filtrados)</span></p>
            <p className={cx('num text-base font-semibold md:text-lg', l === 'Sin costo' && totals.unknownCostCount > 0 && 'text-warning')}>{v}</p>
          </div>
        ))}
      </div>

      <FilterBar filters={filters} setFilters={setFilters} sort={sort} setSort={setSort} view={view} setView={setView}
        cols={cols} setCols={setCols} onOpenSheet={() => setSheet(true)} nFilters={nFilters} />

      {/* Barra de acciones múltiples */}
      {selected.size > 0 && (
        <div className="sticky top-14 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-blue-50 px-3 py-2 shadow-sm md:top-2">
          <span className="text-sm font-medium">{selected.size} seleccionado(s)</span>
          <div className="mx-1 hidden h-5 w-px bg-primary/20 md:block" />
          <Menu label="Cambiar prioridad" trigger={<span className="flex items-center gap-1 px-2 text-sm font-medium text-ink">Prioridad</span>}
            items={PRIORITIES.map((p) => ({ label: PRIORITY_LABEL[p], onClick: () => void bulkPriority(p) }))} />
          <Button size="sm" variant="secondary" icon={<FolderInput className="size-4" />} onClick={() => setMoveOpen(true)}>Mover</Button>
          <Button size="sm" variant="secondary" icon={<Trash2 className="size-4" />} onClick={() => removeRows(selRows)}>Retirar</Button>
          <Button size="sm" variant="secondary" icon={<Archive className="size-4" />} onClick={() => archiveRows(selRows)}>Archivar</Button>
          <Button size="sm" variant="ghost" className="ml-auto" icon={<X className="size-4" />} onClick={() => setSelected(new Set())}>Cancelar</Button>
        </div>
      )}

      {!hasAny ? (
        <EmptyState icon={<ListChecks className="size-6" />} title="Tu lista está vacía"
          text="Agrega productos nuevos o elige artículos de tu catálogo para planificar el surtido inicial."
          action={<div className="flex flex-wrap justify-center gap-2">
            <Button icon={<Plus className="size-4" />} onClick={() => open({})}>Agregar producto</Button>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>Importar desde archivo</Button>
          </div>} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Search className="size-6" />} title="Sin coincidencias"
          text={filters.statuses.length === 2 && data.rows.every((r) => r.status === 'completado') ? '¡Todo está comprado! Consulta la sección Comprados.' : 'No hay productos que coincidan con la búsqueda y los filtros seleccionados.'}
          action={<Button variant="secondary" onClick={() => setFilters({ ...DEFAULT_FILTERS, statuses: [] })}>Limpiar filtros</Button>} />
      ) : (
        <>
          <div className="mb-2 flex items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-4 accent-primary" checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map((r) => r.item.id)))} />
              Seleccionar todos los resultados ({filtered.length})
            </label>
          </div>
          {view === 'tabla'
            ? <TableView rows={visibleRows} selected={selected} toggle={toggle} cols={cols} actions={rowActions} />
            : <CardsView rows={visibleRows} selected={selected} toggle={toggle} actions={rowActions} />}
          {filtered.length > shown && (
            <div className="mt-4 flex flex-col items-center gap-1">
              <Button variant="secondary" onClick={() => setShown((n) => n + PAGE)}>Mostrar {Math.min(PAGE, filtered.length - shown)} más</Button>
              <p className="text-xs text-muted">Mostrando {shown} de {filtered.length}. Usa el buscador o los filtros para encontrar más rápido.</p>
            </div>
          )}
        </>
      )}

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <FilterSheet open={sheet} onClose={() => setSheet(false)} filters={filters} setFilters={setFilters} sort={sort} setSort={setSort} count={filtered.length} />
      {moveOpen && <MoveDialog productIds={selRows.map((r) => r.product.id)} onClose={() => setMoveOpen(false)} onDone={() => setSelected(new Set())} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------
const STATUS_OPTS: Array<[PurchaseStatus, string]> = [['pendiente', 'Pendiente'], ['parcial', 'Parcial'], ['completado', 'Completado']];
const SORT_OPTS: Array<[SortKey, string]> = [['prioridad', 'Prioridad'], ['nombre', 'Nombre'], ['costo', 'Costo pendiente'], ['cantidad', 'Cantidad'], ['departamento', 'Departamento'], ['fecha', 'Fecha de incorporación']];

function useFilterOptions(filters: Filters) {
  const { departments, categories } = useData();
  const deptOpts = departments.map((d) => ({ value: d.id, label: d.name }));
  const dMap = new Map(departments.map((d) => [d.id, d.name]));
  const catOpts = categories
    .filter((c) => filters.departments.length === 0 || filters.departments.includes(c.department_id))
    .sort((a, b) => (dMap.get(a.department_id) ?? '').localeCompare(dMap.get(b.department_id) ?? '') || a.name.localeCompare(b.name))
    .map((c) => ({ value: c.id, label: c.name, group: dMap.get(c.department_id) }));
  return { deptOpts, catOpts };
}

function toggleIn<T>(arr: T[], v: T) { return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]; }

function FilterBar({ filters, setFilters, sort, setSort, view, setView, cols, setCols, onOpenSheet, nFilters }: {
  filters: Filters; setFilters: (f: Filters) => void; sort: Sort; setSort: (s: Sort) => void; view: View; setView: (v: View) => void;
  cols: Record<OptCol, boolean>; setCols: (c: Record<OptCol, boolean>) => void; onOpenSheet: () => void; nFilters: number;
}) {
  const { deptOpts, catOpts } = useFilterOptions(filters);
  const set = (p: Partial<Filters>) => setFilters({ ...filters, ...p });
  return (
    <div className="card mb-4 space-y-3 p-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input type="search" className="input pl-9" placeholder="Buscar productos, marcas, proveedores…"
            value={filters.q} onChange={(e) => set({ q: e.target.value })} aria-label="Buscar productos" />
        </div>
        <Button variant="secondary" className="md:hidden" icon={<SlidersHorizontal className="size-4" />} onClick={onOpenSheet}>
          {nFilters > 0 ? nFilters : ''}
        </Button>
        <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="Vista">
          <button aria-pressed={view === 'tabla'} onClick={() => setView('tabla')} className={cx('flex size-9 items-center justify-center rounded-md', view === 'tabla' ? 'bg-slate-100 text-ink' : 'text-muted')} aria-label="Vista de tabla" title="Tabla"><Table2 className="size-4" /></button>
          <button aria-pressed={view === 'tarjetas'} onClick={() => setView('tarjetas')} className={cx('flex size-9 items-center justify-center rounded-md', view === 'tarjetas' ? 'bg-slate-100 text-ink' : 'text-muted')} aria-label="Vista de tarjetas" title="Tarjetas"><LayoutGrid className="size-4" /></button>
        </div>
      </div>
      {/* Filtros rápidos de prioridad (siempre visibles) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted">Prioridad:</span>
        <button className="chip" aria-pressed={filters.priorities.length === 0} onClick={() => set({ priorities: [] })}>Todas</button>
        {PRIORITIES.map((p) => (
          <button key={p} className="chip" aria-pressed={filters.priorities.includes(p)} onClick={() => set({ priorities: toggleIn(filters.priorities, p) })}>
            <span className={cx('size-2 rounded-full', { alta: 'bg-red-500', media: 'bg-amber-500', baja: 'bg-slate-400' }[p])} />{PRIORITY_LABEL[p]}
          </button>
        ))}
        <span className="ml-2 hidden text-xs font-medium text-muted md:inline">Estado:</span>
        <div className="hidden flex-wrap gap-2 md:flex">
          {STATUS_OPTS.map(([s, l]) => (
            <button key={s} className="chip" aria-pressed={filters.statuses.includes(s)} onClick={() => set({ statuses: toggleIn(filters.statuses, s) })}>{l}</button>
          ))}
        </div>
      </div>
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        <MultiSelect label="Departamento" options={deptOpts} value={filters.departments}
          onChange={(v) => set({ departments: v, categories: filters.categories.filter((c) => catOpts.some((o) => o.value === c)) })} />
        <MultiSelect label="Categoría" options={catOpts} value={filters.categories} onChange={(v) => set({ categories: v })} emptyText="No hay categorías en los departamentos elegidos" />
        <select className="chip pr-8" value={filters.cost} onChange={(e) => set({ cost: e.target.value as Filters['cost'] })} aria-label="Costo">
          <option value="todos">Costo: todos</option><option value="conocido">Con costo</option><option value="desconocido">Sin costo</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          <ArrowDownUp className="size-4 text-muted" />
          <select className="chip pr-8" value={sort.key} onChange={(e) => setSort({ ...sort, key: e.target.value as SortKey })} aria-label="Ordenar por">
            {SORT_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button className="chip" onClick={() => setSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })} aria-label="Dirección de orden">
            {sort.dir === 'asc' ? 'Ascendente' : 'Descendente'}
          </button>
          {view === 'tabla' && (
            <Menu label="Columnas" trigger={<Columns3 className="size-4" />}
              items={(Object.keys(OPTIONAL_COLS) as OptCol[]).map((k) => ({ label: `${cols[k] ? '✓ ' : '  '}${OPTIONAL_COLS[k]}`, onClick: () => setCols({ ...cols, [k]: !cols[k] }) }))} />
          )}
          <Button size="sm" variant="ghost" onClick={() => setFilters({ ...DEFAULT_FILTERS, statuses: [] })} disabled={nFilters === 0}>Limpiar filtros</Button>
        </div>
      </div>
    </div>
  );
}

function FilterSheet({ open, onClose, filters, setFilters, sort, setSort, count }: {
  open: boolean; onClose: () => void; filters: Filters; setFilters: (f: Filters) => void; sort: Sort; setSort: (s: Sort) => void; count: number;
}) {
  const { deptOpts, catOpts } = useFilterOptions(filters);
  const set = (p: Partial<Filters>) => setFilters({ ...filters, ...p });
  const group = (title: string, children: React.ReactNode) => <div><p className="label">{title}</p><div className="flex flex-wrap gap-2">{children}</div></div>;
  return (
    <Modal open={open} onClose={onClose} title="Filtros" size="sm"
      footer={<>
        <Button variant="secondary" onClick={() => setFilters({ ...DEFAULT_FILTERS, statuses: [] })}>Limpiar filtros</Button>
        <Button onClick={onClose}>Ver {count} resultado(s)</Button>
      </>}>
      <div className="space-y-5">
        {group('Estado de compra', STATUS_OPTS.map(([s, l]) => <button key={s} className="chip h-10" aria-pressed={filters.statuses.includes(s)} onClick={() => set({ statuses: toggleIn(filters.statuses, s) })}>{l}</button>))}
        {group('Prioridad', PRIORITIES.map((p) => <button key={p} className="chip h-10" aria-pressed={filters.priorities.includes(p)} onClick={() => set({ priorities: toggleIn(filters.priorities, p) })}>{PRIORITY_LABEL[p]}</button>))}
        {group('Departamento', deptOpts.map((o) => <button key={o.value} className="chip h-10" aria-pressed={filters.departments.includes(o.value)}
          onClick={() => set({ departments: toggleIn(filters.departments, o.value) })}>{o.label}</button>))}
        {catOpts.length > 0 && group('Categoría', catOpts.map((o) => <button key={o.value} className="chip h-10" aria-pressed={filters.categories.includes(o.value)}
          onClick={() => set({ categories: toggleIn(filters.categories, o.value) })}>{o.label}</button>))}
        {group('Costo', ([['todos', 'Todos'], ['conocido', 'Con costo'], ['desconocido', 'Sin costo']] as const).map(([k, l]) =>
          <button key={k} className="chip h-10" aria-pressed={filters.cost === k} onClick={() => set({ cost: k })}>{l}</button>))}
        <div>
          <p className="label">Ordenar por</p>
          <div className="flex gap-2">
            <select className="input" value={sort.key} onChange={(e) => setSort({ ...sort, key: e.target.value as SortKey })}>
              {SORT_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select className="input w-40" value={sort.dir} onChange={(e) => setSort({ ...sort, dir: e.target.value as Sort['dir'] })}>
              <option value="asc">Ascendente</option><option value="desc">Descendente</option>
            </select>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Edición rápida
// ---------------------------------------------------------------------------
function useQuickSave() {
  const data = useData();
  const toast = useToast();
  return async (fn: () => Promise<unknown>, msg = 'Guardado') => {
    try { await fn(); await data.refresh(); toast.success(msg); return true; }
    catch (e) { toast.error(friendlyError(e)); await data.refresh(); return false; }
  };
}

function QtyInput({ row }: { row: PlanRow }) {
  const save = useQuickSave();
  const [v, setV] = useState(String(row.planned));
  useEffect(() => setV(String(row.planned)), [row.planned]);
  const commit = async () => {
    const n = Number(v);
    if (!/^\d+$/.test(v) || n <= 0) { setV(String(row.planned)); return; }
    if (n === row.planned) return;
    if (n < row.bought) { setV(String(row.planned)); void save(async () => { throw new Error(`No puede ser menor a lo ya comprado (${row.bought} pzas)`); }); return; }
    await save(() => api.updateItem(row.item.id, { planned_qty: n }), 'Cantidad actualizada');
  };
  return (
    <input inputMode="numeric" aria-label={`Cantidad planificada de ${row.product.name}`} value={v}
      onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setV(String(row.planned)); }}
      className="num h-8 w-16 rounded-md border border-transparent bg-transparent px-2 text-right text-sm hover:border-line focus:border-primary focus:bg-white focus:outline-none" />
  );
}

function PrioritySelect({ row }: { row: PlanRow }) {
  const save = useQuickSave();
  const styles = { alta: 'bg-red-50 text-red-700 border-red-200', media: 'bg-amber-50 text-amber-800 border-amber-200', baja: 'bg-slate-100 text-slate-600 border-slate-300' };
  return (
    <select aria-label={`Prioridad de ${row.product.name}`} value={row.item.priority}
      onChange={(e) => void save(() => api.updateItem(row.item.id, { priority: e.target.value as Priority }), 'Prioridad actualizada')}
      className={cx('h-7 cursor-pointer rounded-full border px-2 text-xs font-medium', styles[row.item.priority])}>
      {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
    </select>
  );
}

function CostInput({ row }: { row: PlanRow }) {
  const save = useQuickSave();
  const current = row.item.unit_cost === null ? '' : String(Number(row.item.unit_cost).toFixed(2));
  const [v, setV] = useState(current);
  useEffect(() => setV(current), [current]);
  const commit = async () => {
    if (v.trim() === current) return;
    const parsed = parseMoneyInput(v);
    if (v.trim() !== '' && parsed === null) { setV(current); return; }
    await save(() => api.updateItem(row.item.id, { unit_cost: parsed }), 'Costo de la planificación actualizado');
  };
  const isNet = row.item.price_mode === 'antes_impuestos';
  return (
    <div className="flex flex-col items-end">
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs text-muted">$</span>
        <input inputMode="decimal" aria-label={`Costo unitario estimado de ${row.product.name}`} value={v} placeholder="Sin costo"
          onChange={(e) => setV(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setV(current); }}
          className={cx('num h-8 w-24 rounded-md border border-transparent bg-transparent pr-2 pl-5 text-right text-sm hover:border-line focus:border-primary focus:bg-white focus:outline-none placeholder:text-amber-600')} />
      </div>
      {isNet && row.unitFinal && <span className="num text-[11px] text-muted">final {formatMXN(row.unitFinal)}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vistas
// ---------------------------------------------------------------------------
type Actions = (r: PlanRow) => Array<{ label: string; icon?: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string }>;

function TableView({ rows, selected, toggle, cols, actions }: { rows: PlanRow[]; selected: Set<string>; toggle: (id: string) => void; cols: Record<OptCol, boolean>; actions: Actions }) {
  const purchases = usePurchases();
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[880px]">
        <thead className="border-b border-line bg-slate-50/80">
          <tr>
            <th className="th w-10"><span className="sr-only">Seleccionar</span></th>
            <th className="th">Producto</th>
            {cols.clasificacion && <th className="th">Departamento / categoría</th>}
            <th className="th">Prioridad</th>
            <th className="th text-right">Planif.</th>
            <th className="th text-right">Compr.</th>
            <th className="th text-right">Pend.</th>
            {cols.unitario && <th className="th text-right">Costo unit.</th>}
            <th className="th text-right">Costo pendiente</th>
            {cols.proveedor && <th className="th">Proveedor</th>}
            <th className="th text-right">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.item.id} className={cx('transition hover:bg-slate-50/70', selected.has(r.item.id) && 'bg-blue-50/60')}>
              <td className="td"><input type="checkbox" className="size-4 accent-primary" checked={selected.has(r.item.id)} onChange={() => toggle(r.item.id)} aria-label={`Seleccionar ${r.product.name}`} /></td>
              <td className="td max-w-[220px]">
                <p className="truncate font-medium" title={r.product.name}>{r.product.name}</p>
                <p className="truncate text-xs text-muted">{[r.product.brand, r.product.presentation].filter(Boolean).join(' · ') || '—'}</p>
                {r.status === 'parcial' && <ProgressBar value={r.progress} className="mt-1 h-1 w-24" />}
              </td>
              {cols.clasificacion && <td className="td max-w-[180px] text-sm"><p className="truncate" title={r.department?.name}>{r.department?.name ?? '—'}</p><p className="truncate text-xs text-muted" title={r.category?.name}>{r.category?.name ?? 'Sin categoría'}</p></td>}
              <td className="td"><PrioritySelect row={r} /></td>
              <td className="td text-right"><QtyInput row={r} /></td>
              <td className="td num text-right">{r.bought}</td>
              <td className="td num text-right font-medium">{r.pending}</td>
              {cols.unitario && <td className="td text-right"><CostInput row={r} /></td>}
              <td className="td num text-right font-semibold">
                {r.pendingCost === null ? <span className="inline-flex items-center gap-1 text-xs font-medium text-warning"><AlertTriangle className="size-3.5" />Sin costo</span> : formatMXN(r.pendingCost)}
              </td>
              {cols.proveedor && <td className="td max-w-[140px] truncate text-muted">{r.product.supplier ?? '—'}</td>}
              <td className="td">
                <div className="flex items-center justify-end gap-1">
                  {r.pending > 0 && (
                    <Button size="sm" variant="secondary" aria-label="Comprar" title="Registrar compra" className="px-2" icon={<ShoppingBag className="size-4" />}
                      onClick={() => purchases.register(r.item.id)} />
                  )}
                  <Menu items={actions(r)} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CardsView({ rows, selected, toggle, actions }: { rows: PlanRow[]; selected: Set<string>; toggle: (id: string) => void; actions: Actions }) {
  const purchases = usePurchases();
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {rows.map((r) => (
        <article key={r.item.id} className={cx('card flex flex-col p-4 transition', selected.has(r.item.id) && 'ring-2 ring-primary/40')}>
          <div className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 size-5 accent-primary" checked={selected.has(r.item.id)} onChange={() => toggle(r.item.id)} aria-label={`Seleccionar ${r.product.name}`} />
            <div className="min-w-0 flex-1">
              <h3 className="leading-snug font-semibold">{r.product.name}</h3>
              <p className="text-sm text-muted">{[r.product.brand, r.product.presentation].filter(Boolean).join(' · ') || 'Sin marca'}</p>
              <p className="mt-0.5 text-xs text-muted">{r.department?.name ?? 'Sin departamento'}{r.category && ` › ${r.category.name}`}</p>
            </div>
            <Menu items={actions(r)} />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <PriorityBadge p={r.item.priority} /><StatusBadge s={r.status} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2 text-center">
            <div><p className="text-[11px] text-muted">Planificadas</p><p className="num font-semibold">{r.planned}</p></div>
            <div><p className="text-[11px] text-muted">Compradas</p><p className="num font-semibold">{r.bought}</p></div>
            <div><p className="text-[11px] text-muted">Pendientes</p><p className="num font-semibold text-primary">{r.pending}</p></div>
          </div>
          <ProgressBar value={r.progress} tone={r.status === 'completado' ? 'success' : 'primary'} className="mt-2 h-1.5" />
          <div className="mt-3 flex items-end justify-between">
            <div>
              <p className="text-xs text-muted">Costo pendiente</p>
              {r.pendingCost === null
                ? <p className="flex items-center gap-1 text-sm font-medium text-warning"><AlertTriangle className="size-4" />Sin costo</p>
                : <p className="num text-lg font-semibold">{formatMXN(r.pendingCost)}</p>}
              {r.unitFinal && <p className="num text-xs text-muted">{formatMXN(r.unitFinal)} / pza</p>}
            </div>
            {r.pending > 0 && (
              <Button variant="success" size="md" className="h-11" icon={<ShoppingBag className="size-4" />} onClick={() => purchases.register(r.item.id)}>Registrar compra</Button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mover a departamento / categoría (relaciones válidas)
// ---------------------------------------------------------------------------
export function MoveDialog({ productIds, onClose, onDone }: { productIds: string[]; onClose: () => void; onDone?: () => void }) {
  const data = useData();
  const toast = useToast();
  const [dep, setDep] = useState('');
  const [cat, setCat] = useState('');
  const [saving, setSaving] = useState(false);
  const cats = data.categories.filter((c) => c.department_id === dep);
  async function apply() {
    setSaving(true);
    const prev = data.products.filter((p) => productIds.includes(p.id)).map((p) => ({ id: p.id, d: p.department_id, c: p.category_id }));
    try {
      await api.moveProducts(productIds, dep || null, cat || null);
      await data.refresh();
      toast.success(`${productIds.length} producto(s) movidos`, { label: 'Deshacer', run: async () => {
        try { await Promise.all(prev.map((p) => api.moveProducts([p.id], p.d, p.c))); await data.refresh(); } catch (e) { toast.error(friendlyError(e)); }
      } });
      onDone?.();
      onClose();
    } catch (e) { toast.error(friendlyError(e)); } finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title="Mover productos" subtitle={`${productIds.length} producto(s) seleccionados`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={saving} onClick={apply}>Mover</Button></>}>
      <div className="space-y-3">
        <div><label className="label" htmlFor="mv-d">Departamento</label>
          <select id="mv-d" className="input" value={dep} onChange={(e) => { setDep(e.target.value); setCat(''); }}>
            <option value="">Sin departamento</option>{data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></div>
        <div><label className="label" htmlFor="mv-c">Categoría</label>
          <select id="mv-c" className="input" value={cat} onChange={(e) => setCat(e.target.value)} disabled={!dep}>
            <option value="">Sin categoría</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <p className="hint">El cambio se aplica al producto del catálogo, por lo que se refleja en la lista.</p>
      </div>
    </Modal>
  );
}
