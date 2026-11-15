import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronRight, FolderTree, Pencil, Plus, Trash2, X, MoveRight } from 'lucide-react';
import { useData } from '@/data/DataContext';
import * as api from '@/data/api';
import { friendlyError } from '@/data/supabase';
import { applyFilters, DEFAULT_FILTERS } from '@/lib/filters';
import { formatMXN } from '@/lib/money';
import { totalsOf } from '@/lib/budget';
import type { Category, Department, Priority, PurchaseStatus } from '@/lib/types';
import { PRIORITIES, PRIORITY_LABEL } from '@/lib/types';
import { PageHeader } from '@/components/Layout';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { useProductForm } from '@/components/ProductForm';
import { Button, EmptyState, IconButton, Modal, PriorityBadge, StatusBadge, cx } from '@/components/ui';

function InlineName({ initial, onSave, onCancel, placeholder }: { initial: string; onSave: (v: string) => void; onCancel: () => void; placeholder?: string }) {
  const [v, setV] = useState(initial);
  return (
    <form className="flex flex-1 gap-1" onSubmit={(e) => { e.preventDefault(); if (v.trim()) onSave(v.trim()); }}>
      <input autoFocus className="input h-9" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onCancel()} />
      <IconButton label="Guardar" type="submit" disabled={!v.trim()}><Check className="size-4 text-success" /></IconButton>
      <IconButton label="Cancelar" onClick={onCancel}><X className="size-4" /></IconButton>
    </form>
  );
}

export default function Departments() {
  const data = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const { open } = useProductForm();
  const [depId, setDepId] = useState<string | null>(null);
  const [catId, setCatId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // id o 'new-dep' / 'new-cat'
  const [deleteCat, setDeleteCat] = useState<Category | null>(null);
  const [moveCat, setMoveCat] = useState<Category | null>(null);
  const [prio, setPrio] = useState<Priority[]>([]);
  const [status, setStatus] = useState<PurchaseStatus[]>([]);

  const dep = data.departments.find((d) => d.id === depId) ?? data.departments[0] ?? null;
  const cats = data.categories.filter((c) => c.department_id === dep?.id).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const cat = cats.find((c) => c.id === catId) ?? null;
  const countProducts = (pred: (p: { department_id: string | null; category_id: string | null }) => boolean) => data.products.filter((p) => !p.archived && pred(p)).length;

  const rows = useMemo(() => dep ? applyFilters(data.rows, {
    ...DEFAULT_FILTERS, statuses: status, priorities: prio, departments: [dep.id], categories: cat ? [cat.id] : [],
  }) : [], [data.rows, dep, cat, prio, status]);
  const totals = totalsOf(rows);

  async function act(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); await data.refresh(); toast.success(ok); setEditing(null); } catch (e) { toast.error(friendlyError(e)); }
  }
  async function swap<T extends Department | Category>(list: T[], i: number, j: number, update: (id: string, o: number) => Promise<void>) {
    if (j < 0 || j >= list.length) return;
    // normaliza el orden y luego intercambia
    const ordered = list.map((x, k) => ({ id: x.id, o: k }));
    [ordered[i].o, ordered[j].o] = [ordered[j].o, ordered[i].o];
    await act(() => Promise.all(ordered.map((x) => update(x.id, x.o))), 'Orden actualizado');
  }
  async function removeDep(d: Department) {
    const n = countProducts((p) => p.department_id === d.id) + data.products.filter((p) => p.archived && p.department_id === d.id).length;
    const nc = data.categories.filter((c) => c.department_id === d.id).length;
    if (n > 0 || nc > 0) { toast.error(`No se puede eliminar: tiene ${nc} categoría(s) y ${n} producto(s). Muévelos primero.`); return; }
    if (await confirm({ title: 'Eliminar departamento', danger: true, confirm: 'Eliminar', text: <>¿Eliminar el departamento <b>{d.name}</b>?</> }))
      await act(() => api.deleteDepartment(d.id), 'Departamento eliminado');
  }

  return (
    <div>
      <PageHeader title="Departamentos y categorías" description="Organiza tus productos: Departamento → Categoría → Producto." />
      <div className="grid gap-4 lg:grid-cols-[280px_300px_1fr]">
        {/* Departamentos */}
        <section className="card p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-sm font-semibold">Departamentos</h2>
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setEditing('new-dep')}>Nuevo</Button>
          </div>
          {editing === 'new-dep' && <div className="mb-2"><InlineName initial="" placeholder="Nombre del departamento" onCancel={() => setEditing(null)}
            onSave={(n) => act(() => api.createDepartment(n, data.departments.length + 1), 'Departamento creado')} /></div>}
          <ul className="space-y-0.5">
            {data.departments.map((d, i) => (
              <li key={d.id} className={cx('group flex items-center gap-1 rounded-lg px-1', dep?.id === d.id && 'bg-primary/10')}>
                {editing === d.id ? <InlineName initial={d.name} onCancel={() => setEditing(null)} onSave={(n) => act(() => api.updateDepartment(d.id, { name: n }), 'Departamento renombrado')} /> : (
                  <>
                    <button className="flex min-h-10 flex-1 items-center gap-2 px-2 text-left text-sm" onClick={() => { setDepId(d.id); setCatId(null); }}>
                      <span className={cx('flex-1', dep?.id === d.id && 'font-medium text-primary-dark')}>{d.name}</span>
                      <span className="num text-xs text-muted">{countProducts((p) => p.department_id === d.id)}</span>
                    </button>
                    <div className="flex opacity-100 transition lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
                      <IconButton label="Subir" onClick={() => swap(data.departments, i, i - 1, (id, o) => api.updateDepartment(id, { sort_order: o }))}><ArrowUp className="size-3.5" /></IconButton>
                      <IconButton label="Bajar" onClick={() => swap(data.departments, i, i + 1, (id, o) => api.updateDepartment(id, { sort_order: o }))}><ArrowDown className="size-3.5" /></IconButton>
                      <IconButton label="Renombrar" onClick={() => setEditing(d.id)}><Pencil className="size-3.5" /></IconButton>
                      <IconButton label="Eliminar" onClick={() => removeDep(d)}><Trash2 className="size-3.5" /></IconButton>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Categorías */}
        <section className="card p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="truncate text-sm font-semibold">Categorías{dep && <span className="font-normal text-muted"> · {dep.name}</span>}</h2>
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} disabled={!dep} onClick={() => setEditing('new-cat')}>Nueva</Button>
          </div>
          {editing === 'new-cat' && dep && <div className="mb-2"><InlineName initial="" placeholder="Ej. Detergentes" onCancel={() => setEditing(null)}
            onSave={(n) => act(() => api.createCategory(dep.id, n, cats.length + 1), 'Categoría creada')} /></div>}
          {cats.length === 0 && editing !== 'new-cat' && <p className="px-2 py-6 text-center text-sm text-muted">Sin categorías. Crea la primera con “Nueva”.</p>}
          <button className={cx('mb-0.5 flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm', !cat && 'bg-primary/10 font-medium text-primary-dark')} onClick={() => setCatId(null)}>
            Todas las categorías
          </button>
          <ul className="space-y-0.5">
            {cats.map((c, i) => (
              <li key={c.id} className={cx('group flex items-center gap-1 rounded-lg px-1', cat?.id === c.id && 'bg-primary/10')}>
                {editing === c.id ? <InlineName initial={c.name} onCancel={() => setEditing(null)} onSave={(n) => act(() => api.updateCategory(c.id, { name: n }), 'Categoría renombrada')} /> : (
                  <>
                    <button className="flex min-h-10 flex-1 items-center gap-2 px-2 text-left text-sm" onClick={() => setCatId(c.id)}>
                      <ChevronRight className="size-3.5 text-muted" />
                      <span className={cx('flex-1', cat?.id === c.id && 'font-medium text-primary-dark')}>{c.name}</span>
                      <span className="num text-xs text-muted">{countProducts((p) => p.category_id === c.id)}</span>
                    </button>
                    <div className="flex opacity-100 transition lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
                      <IconButton label="Subir" onClick={() => swap(cats, i, i - 1, (id, o) => api.updateCategory(id, { sort_order: o }))}><ArrowUp className="size-3.5" /></IconButton>
                      <IconButton label="Bajar" onClick={() => swap(cats, i, i + 1, (id, o) => api.updateCategory(id, { sort_order: o }))}><ArrowDown className="size-3.5" /></IconButton>
                      <IconButton label="Renombrar" onClick={() => setEditing(c.id)}><Pencil className="size-3.5" /></IconButton>
                      <IconButton label="Mover a otro departamento" onClick={() => setMoveCat(c)}><MoveRight className="size-3.5" /></IconButton>
                      <IconButton label="Eliminar" onClick={() => setDeleteCat(c)}><Trash2 className="size-3.5" /></IconButton>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Productos relacionados */}
        <section className="card p-3 md:p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="flex-1 text-sm font-semibold">{dep?.name ?? '—'}{cat && ` › ${cat.name}`}</h2>
            <Button size="sm" icon={<Plus className="size-4" />} disabled={!dep} onClick={() => open({ kind: 'new', addToList: true, departmentId: dep?.id, categoryId: cat?.id })}>Agregar producto</Button>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {PRIORITIES.map((p) => <button key={p} className="chip" aria-pressed={prio.includes(p)} onClick={() => setPrio(prio.includes(p) ? prio.filter((x) => x !== p) : [...prio, p])}>{PRIORITY_LABEL[p]}</button>)}
            {(['pendiente', 'parcial', 'completado'] as PurchaseStatus[]).map((s) => (
              <button key={s} className="chip" aria-pressed={status.includes(s)} onClick={() => setStatus(status.includes(s) ? status.filter((x) => x !== s) : [...status, s])}>
                {{ pendiente: 'Pendientes', parcial: 'Parciales', completado: 'Completados' }[s]}
              </button>
            ))}
          </div>
          <p className="num mb-2 text-sm text-muted">{rows.length} en la lista · pendiente {formatMXN(totals.pendingCost)} · proyectado {formatMXN(totals.projected)}</p>
          {rows.length === 0 ? <EmptyState icon={<FolderTree className="size-6" />} title="Sin productos" text="No hay productos en la lista con esta clasificación y filtros." /> : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {rows.map((r) => (
                <li key={r.item.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1"><b className="font-medium">{r.product.name}</b>{r.product.brand && <span className="text-muted"> · {r.product.brand}</span>}
                    <span className="block text-xs text-muted">{r.category?.name ?? 'Sin categoría'}</span></span>
                  <PriorityBadge p={r.item.priority} /><StatusBadge s={r.status} />
                  <span className="num w-24 text-right">{r.bought}/{r.planned} pzas</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {deleteCat && <DeleteCategoryDialog cat={deleteCat} onClose={() => setDeleteCat(null)} onDeleted={() => setCatId(null)} />}
      {moveCat && <MoveCategoryDialog cat={moveCat} onClose={() => setMoveCat(null)} />}
    </div>
  );
}

function DeleteCategoryDialog({ cat, onClose, onDeleted }: { cat: Category; onClose: () => void; onDeleted: () => void }) {
  const data = useData();
  const toast = useToast();
  const n = data.products.filter((p) => p.category_id === cat.id).length;
  const [mode, setMode] = useState<'reasignar' | 'sin_categoria'>('reasignar');
  const others = data.categories.filter((c) => c.id !== cat.id);
  const dMap = new Map(data.departments.map((d) => [d.id, d.name]));
  const [target, setTarget] = useState(others[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  async function go() {
    setSaving(true);
    try {
      await api.deleteCategory(cat.id, n > 0 ? mode : null, n > 0 && mode === 'reasignar' ? target : null);
      await data.refresh(); toast.success('Categoría eliminada'); onDeleted(); onClose();
    } catch (e) { toast.error(friendlyError(e)); } finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} size="sm" title={`Eliminar “${cat.name}”`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant="danger" loading={saving} disabled={n > 0 && mode === 'reasignar' && !target} onClick={go}>Eliminar categoría</Button></>}>
      {n === 0 ? <p className="text-sm">La categoría no tiene productos. ¿Eliminarla?</p> : (
        <div className="space-y-3 text-sm">
          <p>Esta categoría contiene <b>{n}</b> producto(s). Indica qué hacer con ellos:</p>
          <label className="flex items-start gap-2"><input type="radio" className="mt-1 accent-primary" checked={mode === 'reasignar'} onChange={() => setMode('reasignar')} disabled={others.length === 0} />
            <span>Reasignarlos a otra categoría
              {mode === 'reasignar' && <select className="input mt-2" value={target} onChange={(e) => setTarget(e.target.value)}>
                {others.map((c) => <option key={c.id} value={c.id}>{dMap.get(c.department_id)} › {c.name}</option>)}
              </select>}
            </span></label>
          <label className="flex items-start gap-2"><input type="radio" className="mt-1 accent-primary" checked={mode === 'sin_categoria'} onChange={() => setMode('sin_categoria')} />
            <span>Dejarlos sin categoría (conservan el departamento)</span></label>
        </div>
      )}
    </Modal>
  );
}

function MoveCategoryDialog({ cat, onClose }: { cat: Category; onClose: () => void }) {
  const data = useData();
  const toast = useToast();
  const [dep, setDep] = useState(cat.department_id);
  async function go() {
    try { await api.updateCategory(cat.id, { department_id: dep }); await data.refresh(); toast.success('Categoría movida; sus productos la siguen'); onClose(); }
    catch (e) { toast.error(friendlyError(e)); }
  }
  return (
    <Modal open onClose={onClose} size="sm" title={`Mover “${cat.name}”`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={go} disabled={dep === cat.department_id}>Mover</Button></>}>
      <label className="label" htmlFor="mc">Nuevo departamento</label>
      <select id="mc" className="input" value={dep} onChange={(e) => setDep(e.target.value)}>
        {data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <p className="hint">Los productos de la categoría se moverán automáticamente al nuevo departamento.</p>
    </Modal>
  );
}
