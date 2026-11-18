import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Archive, ArchiveRestore, BookOpen, FileUp, FolderInput, ListPlus, Pencil, Plus, Search, X } from 'lucide-react';
import { useData } from '@/data/DataContext';
import * as api from '@/data/api';
import { friendlyError } from '@/data/supabase';
import { finalUnitCost } from '@/lib/tax';
import { formatMXN } from '@/lib/money';
import { matchesQuery, normalize, relevance } from '@/lib/search';
import { STATUS_LABEL } from '@/lib/types';
import type { Product } from '@/lib/types';
import { PageHeader } from '@/components/Layout';
import { useProductForm } from '@/components/ProductForm';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { Menu } from '@/components/Menu';
import { MultiSelect } from '@/components/MultiSelect';
import { Button, EmptyState, Skeleton, cx } from '@/components/ui';
import { MoveDialog } from './ShoppingList';
import { ImportDialog } from '@/components/ImportDialog';

export default function Catalog() {
  const data = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const { open } = useProductForm();
  const [q, setQ] = useState('');
  const [deps, setDeps] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [inList, setInList] = useState<'todos' | 'si' | 'no'>('todos');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const dMap = useMemo(() => new Map(data.departments.map((d) => [d.id, d.name])), [data.departments]);
  const cMap = useMemo(() => new Map(data.categories.map((c) => [c.id, c.name])), [data.categories]);
  const rowByProduct = useMemo(() => new Map(data.rows.map((r) => [r.product.id, r])), [data.rows]);

  const dq = useDeferredValue(q);
  const [shown, setShown] = useState(100);
  useEffect(() => setShown(100), [dq, deps, showArchived, inList]);
  const list = useMemo(() => {
    return data.products
      .filter((p) => p.archived === showArchived)
      .filter((p) => deps.length === 0 || deps.includes(p.department_id ?? ''))
      .filter((p) => inList === 'todos' || (inList === 'si') === rowByProduct.has(p.id))
      .filter((p) => matchesQuery(dq, [p.name, p.brand, p.presentation, p.supplier, dMap.get(p.department_id ?? ''), cMap.get(p.category_id ?? '')]))
      .sort((a, b) => dq
        ? relevance(dq, b.name, []) - relevance(dq, a.name, []) || normalize(a.name).localeCompare(normalize(b.name), 'es')
        : normalize(a.name).localeCompare(normalize(b.name), 'es'));
  }, [data.products, showArchived, deps, inList, dq, rowByProduct, dMap, cMap]);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const sel = list.filter((p) => selected.has(p.id));

  async function archive(ps: Product[], archived: boolean) {
    const blocked = archived ? ps.filter((p) => rowByProduct.has(p.id)) : [];
    const ok = ps.filter((p) => !blocked.includes(p));
    if (ok.length === 0) { toast.error('Retira primero los productos de la lista de compras para archivarlos.'); return; }
    if (archived) {
      const yes = await confirm({ title: 'Archivar productos', confirm: 'Archivar', danger: true,
        text: <p>Se archivarán <b>{ok.length}</b> producto(s). No se borran: puedes reactivarlos cuando quieras.
          {blocked.length > 0 && ` ${blocked.length} que están en la lista se conservarán activos.`}</p> });
      if (!yes) return;
    }
    const ids = ok.map((p) => p.id);
    try {
      await api.setProductsArchived(ids, archived);
      await data.refresh();
      toast.success(archived ? `${ids.length} producto(s) archivados` : `${ids.length} producto(s) reactivados`, {
        label: 'Deshacer', run: async () => { try { await api.setProductsArchived(ids, !archived); await data.refresh(); } catch (e) { toast.error(friendlyError(e)); } },
      });
      setSelected(new Set());
    } catch (e) { toast.error(friendlyError(e)); }
  }

  if (data.loading) return <div className="space-y-3"><Skeleton className="h-10 w-60" />{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>;

  return (
    <div>
      <PageHeader title="Catálogo" description="Tus productos reutilizables. Comienza vacío: agrega tus propios artículos."
        actions={<>
          <Button variant="secondary" icon={<FileUp className="size-4" />} onClick={() => setImportOpen(true)}>Importar</Button>
          <Button className="max-md:!hidden" icon={<Plus className="size-4" />} onClick={() => open({ kind: 'new', addToList: false })}>Nuevo producto</Button>
        </>} />

      <div className="card mb-4 flex flex-col gap-2 p-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input type="search" className="input pl-9" placeholder="Buscar en catálogo y planificación…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar en catálogo" />
        </div>
        <div className="flex flex-wrap gap-2">
          <MultiSelect label="Departamento" options={data.departments.map((d) => ({ value: d.id, label: d.name }))} value={deps} onChange={setDeps} />
          <select className="chip pr-8" value={inList} onChange={(e) => setInList(e.target.value as typeof inList)} aria-label="Presencia en la lista">
            <option value="todos">Todos</option><option value="si">En la lista</option><option value="no">No están en la lista</option>
          </select>
          <button className="chip" aria-pressed={showArchived} onClick={() => { setShowArchived((v) => !v); setSelected(new Set()); }}>
            <Archive className="size-4" /> Archivados
          </button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-14 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-blue-50 px-3 py-2 md:top-2">
          <span className="text-sm font-medium">{selected.size} seleccionado(s)</span>
          {!showArchived && <Button size="sm" variant="secondary" icon={<FolderInput className="size-4" />} onClick={() => setMoveOpen(true)}>Mover</Button>}
          {showArchived
            ? <Button size="sm" variant="secondary" icon={<ArchiveRestore className="size-4" />} onClick={() => archive(sel, false)}>Reactivar</Button>
            : <Button size="sm" variant="secondary" icon={<Archive className="size-4" />} onClick={() => archive(sel, true)}>Archivar</Button>}
          <Button size="sm" variant="ghost" className="ml-auto" icon={<X className="size-4" />} onClick={() => setSelected(new Set())}>Cancelar</Button>
        </div>
      )}

      {data.products.length === 0 ? (
        <EmptyState icon={<BookOpen className="size-6" />} title="Tu catálogo está vacío"
          text="No hay productos precargados. Agrega tus artículos y luego inclúyelos en la lista de compras."
          action={<div className="flex flex-wrap justify-center gap-2">
            <Button icon={<Plus className="size-4" />} onClick={() => open({ kind: 'new', addToList: false })}>Crear primer producto</Button>
            <Button variant="secondary" icon={<FileUp className="size-4" />} onClick={() => setImportOpen(true)}>Importar desde archivo</Button>
          </div>} />
      ) : list.length === 0 ? (
        <EmptyState icon={<Search className="size-6" />} title="Sin coincidencias" text={`No se encontraron productos${q ? ` para “${q}”` : ''}.`} />
      ) : (
        <div className="card divide-y divide-line">
          <label className="flex items-center gap-2 px-4 py-2 text-sm text-muted">
            <input type="checkbox" className="size-4 accent-primary" checked={list.every((p) => selected.has(p.id))}
              onChange={(e) => setSelected(e.target.checked ? new Set(list.map((p) => p.id)) : new Set())} />
            Seleccionar todos ({list.length})
          </label>
          {list.slice(0, shown).map((p) => {
            const row = rowByProduct.get(p.id);
            const cost = finalUnitCost(p);
            return (
              <div key={p.id} className={cx('flex items-center gap-3 px-4 py-3', selected.has(p.id) && 'bg-blue-50/60')}>
                <input type="checkbox" className="size-4 accent-primary" checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Seleccionar ${p.name}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{p.name}</p>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">Catálogo</span>
                    {row && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700">En la lista · {STATUS_LABEL[row.status]}</span>}
                    {p.archived && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">Archivado</span>}
                  </div>
                  <p className="truncate text-sm text-muted">
                    {[p.brand, p.presentation].filter(Boolean).join(' · ') || 'Sin marca'} · {dMap.get(p.department_id ?? '') ?? 'Sin departamento'}
                    {p.category_id && ` › ${cMap.get(p.category_id)}`}{p.supplier && ` · ${p.supplier}`}
                  </p>
                </div>
                <div className="hidden text-right md:block">
                  <p className="num text-sm font-medium">{cost ? formatMXN(cost) : <span className="text-warning">Sin costo</span>}</p>
                  <p className="text-xs text-muted">costo general</p>
                </div>
                {!p.archived && !row && (
                  <Button size="sm" variant="secondary" icon={<ListPlus className="size-4" />} onClick={() => open({ kind: 'addExisting', product: p })}>
                    <span className="hidden sm:inline">Agregar a la lista</span>
                  </Button>
                )}
                <Menu items={[
                  { label: 'Editar', icon: <Pencil className="size-4" />, onClick: () => open({ kind: 'editProduct', product: p }) },
                  ...(!p.archived && !row ? [{ label: 'Agregar a la lista', icon: <ListPlus className="size-4" />, onClick: () => open({ kind: 'addExisting', product: p }) }] : []),
                  p.archived
                    ? { label: 'Reactivar', icon: <ArchiveRestore className="size-4" />, onClick: () => void archive([p], false) }
                    : { label: 'Archivar', icon: <Archive className="size-4" />, danger: true, disabled: !!row, hint: row ? 'Está en la lista de compras' : undefined, onClick: () => void archive([p], true) },
                ]} />
              </div>
            );
          })}
          {list.length > shown && (
            <div className="flex flex-col items-center gap-1 px-4 py-4">
              <Button variant="secondary" onClick={() => setShown((n) => n + 100)}>Mostrar {Math.min(100, list.length - shown)} más</Button>
              <p className="text-xs text-muted">Mostrando {shown} de {list.length}</p>
            </div>
          )}
        </div>
      )}
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      {moveOpen && <MoveDialog productIds={sel.map((p) => p.id)} onClose={() => setMoveOpen(false)} onDone={() => setSelected(new Set())} />}
    </div>
  );
}
