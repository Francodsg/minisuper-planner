import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, Info, Plus } from 'lucide-react';
import { useData } from '@/data/DataContext';
import * as api from '@/data/api';
import { friendlyError } from '@/data/supabase';
import { computeTaxes, TAX_DISCLAIMER } from '@/lib/tax';
import { formatMXN, parseMoneyInput } from '@/lib/money';
import { dedupeKey, similarity } from '@/lib/search';
import type { CostConfig, ListItem, Priority, Product } from '@/lib/types';
import { PRIORITIES, PRIORITY_LABEL } from '@/lib/types';
import { Button, Field, Modal, Section, cx } from './ui';
import { useToast } from './Toast';

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------
const moneyStr = z.string().refine((v) => v.trim() === '' || parseMoneyInput(v) !== null, 'Importe inválido (usa números, p. ej. 25.50)');
const rateStr = z.string().refine((v) => /^\d+(\.\d{1,4})?$/.test(v.trim()) && Number(v) <= 100, 'Tasa entre 0 y 100');
const qtyStr = z.string().refine((v) => /^\d+$/.test(v.trim()) && Number(v) > 0 && Number(v) <= 1_000_000, 'Cantidad en piezas: entero mayor a 0');

const schema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(160),
  brand: z.string().max(80),
  presentation: z.string().max(80),
  department_id: z.string(),
  category_id: z.string(),
  supplier: z.string().max(120),
  notes: z.string().max(1000),
  unit_cost: moneyStr,
  price_mode: z.enum(['antes_impuestos', 'con_impuestos']),
  iva_kind: z.enum(['exento', 'tasa_cero', 'tasa']),
  iva_rate: rateStr,
  ieps_kind: z.enum(['no_aplica', 'porcentaje', 'cuota_fija']),
  ieps_value: z.string(),
  add_to_list: z.boolean(),
  planned_qty: z.string(),
  priority: z.enum(['alta', 'media', 'baja']),
  item_notes: z.string().max(1000),
  sync_catalog_cost: z.boolean(),
}).superRefine((v, ctx) => {
  if (v.add_to_list && !qtyStr.safeParse(v.planned_qty).success)
    ctx.addIssue({ code: 'custom', path: ['planned_qty'], message: 'Cantidad en piezas: entero mayor a 0' });
  if (v.ieps_kind !== 'no_aplica' && parseMoneyInput(v.ieps_value) === null)
    ctx.addIssue({ code: 'custom', path: ['ieps_value'], message: 'Indica el valor del IEPS' });
  if (v.ieps_kind === 'porcentaje' && Number(v.ieps_value) > 300)
    ctx.addIssue({ code: 'custom', path: ['ieps_value'], message: 'Porcentaje demasiado alto' });
});
type FormValues = z.infer<typeof schema>;

// ---------------------------------------------------------------------------
// API del formulario (contexto, para abrirlo desde cualquier pantalla)
// ---------------------------------------------------------------------------
export type FormMode =
  | { kind: 'new'; addToList?: boolean; departmentId?: string; categoryId?: string }
  | { kind: 'editProduct'; product: Product }
  | { kind: 'addExisting'; product: Product }
  | { kind: 'editItem'; item: ListItem; product: Product };

const Ctx = createContext<{ open: (m: Partial<FormMode> & { kind?: FormMode['kind'] }) => void } | null>(null);

export function ProductFormProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<FormMode | null>(null);
  const [key, setKey] = useState(0);
  const open = useCallback((m: Partial<FormMode> & { kind?: FormMode['kind'] }) => {
    setMode((m.kind ? m : { kind: 'new', addToList: true, ...m }) as FormMode);
    setKey((k) => k + 1);
  }, []);
  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {mode && <ProductFormModal key={key} mode={mode} onClose={() => setMode(null)} onSwitch={(m) => { setMode(m); setKey((k) => k + 1); }} />}
    </Ctx.Provider>
  );
}

export function useProductForm() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useProductForm fuera de su proveedor');
  return c;
}

// ---------------------------------------------------------------------------
function str(v: unknown) { return v === null || v === undefined ? '' : String(v); }

function defaults(mode: FormMode): FormValues {
  const p = 'product' in mode ? mode.product : null;
  const it = mode.kind === 'editItem' ? mode.item : null;
  const cost: CostConfig | null = it ?? p;
  return {
    name: p?.name ?? '',
    brand: str(p?.brand),
    presentation: str(p?.presentation),
    department_id: p?.department_id ?? (mode.kind === 'new' ? mode.departmentId ?? '' : ''),
    category_id: p?.category_id ?? (mode.kind === 'new' ? mode.categoryId ?? '' : ''),
    supplier: str(p?.supplier),
    notes: str(p?.notes),
    unit_cost: str(cost?.unit_cost),
    price_mode: cost?.price_mode ?? 'con_impuestos',
    iva_kind: cost?.iva_kind ?? 'tasa',
    iva_rate: cost ? String(Number(cost.iva_rate)) : '16',
    ieps_kind: cost?.ieps_kind ?? 'no_aplica',
    ieps_value: cost && cost.ieps_kind !== 'no_aplica' ? String(Number(cost.ieps_value)) : '',
    add_to_list: mode.kind === 'new' ? mode.addToList !== false : mode.kind !== 'editProduct',
    planned_qty: it ? String(it.planned_qty) : '',
    priority: it?.priority ?? 'media',
    item_notes: str(it?.notes),
    sync_catalog_cost: false,
  };
}

function toCost(v: FormValues): CostConfig {
  return {
    unit_cost: parseMoneyInput(v.unit_cost),
    price_mode: v.price_mode,
    iva_kind: v.iva_kind,
    iva_rate: v.iva_kind === 'tasa' ? v.iva_rate : '0',
    ieps_kind: v.ieps_kind,
    ieps_value: v.ieps_kind === 'no_aplica' ? '0' : parseMoneyInput(v.ieps_value) ?? '0',
  };
}

function ProductFormModal({ mode, onClose, onSwitch }: { mode: FormMode; onClose: () => void; onSwitch: (m: FormMode) => void }) {
  const data = useData();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [newCat, setNewCat] = useState<string | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults(mode), mode: 'onTouched' });
  const { register, handleSubmit, setValue, control, formState: { errors } } = form;
  const v = useWatch({ control }) as FormValues;

  const readOnlyProduct = mode.kind === 'addExisting';
  const showList = mode.kind !== 'editProduct';
  const listToggle = mode.kind === 'new';
  const inList = v.add_to_list || mode.kind === 'editItem' || mode.kind === 'addExisting';

  const cats = data.categories.filter((c) => c.department_id === v.department_id);
  const taxes = computeTaxes(toCost(v));
  const qty = /^\d+$/.test(v.planned_qty ?? '') ? Number(v.planned_qty) : 0;
  const editingId = 'product' in mode ? mode.product.id : null;

  // Detección de duplicados
  const exactKey = dedupeKey(v.name ?? '', v.brand, v.presentation);
  const similar = useMemo(() => {
    if (!v.name || v.name.trim().length < 3 || readOnlyProduct) return [];
    return data.products
      .filter((p) => !p.archived && p.id !== editingId)
      .map((p) => ({ p, s: similarity(`${p.name} ${p.brand ?? ''}`, `${v.name} ${v.brand ?? ''}`) }))
      .filter((x) => x.s >= 0.75 || x.p.dedupe_key === exactKey)
      .sort((a, b) => b.s - a.s)
      .slice(0, 4)
      .map((x) => x.p);
  }, [v.name, v.brand, exactKey, data.products, editingId, readOnlyProduct]);
  const exactDup = similar.find((p) => p.dedupe_key === exactKey);
  const activeItemFor = (pid: string) => data.items.find((i) => i.product_id === pid && !i.removed_at);
  const alreadyInList = mode.kind === 'addExisting' ? activeItemFor(mode.product.id) : undefined;

  const onSubmit = handleSubmit(async (values) => {
    if (exactDup) { toast.error('Ya existe un producto con el mismo nombre, marca y presentación.'); return; }
    if (alreadyInList) { toast.error('Este producto ya está en la lista de compras.'); return; }
    setSaving(true);
    try {
      const cost = toCost(values);
      const productInput: api.ProductInput = {
        name: values.name, brand: values.brand, presentation: values.presentation,
        department_id: values.department_id || null, category_id: values.category_id || null,
        supplier: values.supplier, notes: values.notes, ...cost,
      };
      const itemInput: api.ItemInput = {
        planned_qty: Number(values.planned_qty), priority: values.priority as Priority,
        notes: values.item_notes.trim() || null, ...cost,
      };
      if (mode.kind === 'new') {
        const p = await api.createProduct(productInput);
        if (values.add_to_list) {
          if (!data.listId) throw new Error('No se encontró la lista de compras');
          await api.addToList(data.listId, p.id, itemInput);
          toast.success(`“${p.name}” agregado a la lista`);
        } else toast.success(`“${p.name}” guardado en el catálogo`);
      } else if (mode.kind === 'editProduct') {
        await api.updateProduct(mode.product.id, productInput);
        toast.success('Producto actualizado');
      } else if (mode.kind === 'addExisting') {
        if (!data.listId) throw new Error('No se encontró la lista de compras');
        await api.addToList(data.listId, mode.product.id, itemInput);
        toast.success(`“${mode.product.name}” agregado a la lista`);
      } else {
        // edición de un artículo planificado: la planificación conserva su propio costo
        const { name, brand, presentation, department_id, category_id, supplier, notes } = productInput;
        const productCost: CostConfig = values.sync_catalog_cost ? cost : mode.product;
        await api.updateProduct(mode.product.id, {
          name, brand, presentation, department_id, category_id, supplier, notes,
          unit_cost: productCost.unit_cost, price_mode: productCost.price_mode, iva_kind: productCost.iva_kind,
          iva_rate: productCost.iva_rate, ieps_kind: productCost.ieps_kind, ieps_value: productCost.ieps_value,
        });
        await api.updateItem(mode.item.id, itemInput);
        toast.success('Cambios guardados');
      }
      await data.refresh();
      onClose();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSaving(false);
    }
  });

  async function createCategory() {
    if (!newCat?.trim() || !v.department_id) return;
    try {
      const c = await api.createCategory(v.department_id, newCat);
      await data.refresh();
      setValue('category_id', c.id);
      setNewCat(null);
      toast.success(`Categoría “${c.name}” creada`);
    } catch (e) { toast.error(friendlyError(e)); }
  }

  const titles = { new: 'Agregar producto', editProduct: 'Editar producto del catálogo', addExisting: 'Agregar a la lista de compras', editItem: 'Editar artículo de la lista' };
  const bought = mode.kind === 'editItem' ? data.rows.find((r) => r.item.id === mode.item.id)?.bought ?? 0 : 0;

  return (
    <Modal open onClose={onClose} title={titles[mode.kind]} size="lg" side
      subtitle={mode.kind === 'editItem' ? 'Los cambios de costo afectan solo a esta planificación, salvo que indiques lo contrario.' : undefined}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={onSubmit} loading={saving} disabled={!!exactDup || !!alreadyInList}>
          {mode.kind === 'addExisting' ? 'Agregar a la lista' : 'Guardar producto'}
        </Button>
      </>}>
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <Section n={1} title="Identificación">
          {readOnlyProduct ? (
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="font-medium">{mode.product.name}</p>
              <p className="text-muted">{[mode.product.brand, mode.product.presentation].filter(Boolean).join(' · ') || 'Sin marca'}</p>
              {alreadyInList && <p className="mt-2 font-medium text-danger">Este producto ya está en la lista de compras.</p>}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-6">
              <Field label="Nombre *" htmlFor="f-name" error={errors.name?.message} className="md:col-span-6">
                <input id="f-name" autoFocus className={cx('input', errors.name && 'input-error')} placeholder="Ej. Aceite vegetal" {...register('name')} />
              </Field>
              <Field label="Marca" htmlFor="f-brand" className="md:col-span-3">
                <input id="f-brand" className="input" placeholder="Opcional" {...register('brand')} />
              </Field>
              <Field label="Presentación / descripción" htmlFor="f-pres" className="md:col-span-3" hint="Ej. 1 L, 500 g, paquete 4 pzas">
                <input id="f-pres" className="input" placeholder="Opcional" {...register('presentation')} />
              </Field>
              {similar.length > 0 && (
                <div className={cx('rounded-lg border p-3 text-sm md:col-span-6', exactDup ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50')}>
                  <p className="flex items-center gap-2 font-medium">
                    <AlertTriangle className={cx('size-4', exactDup ? 'text-danger' : 'text-warning')} />
                    {exactDup ? 'Ya existe un producto idéntico (nombre, marca y presentación).' : 'Posibles duplicados. Si es otra presentación, indícala para distinguirlo.'}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {similar.map((p) => {
                      const itm = activeItemFor(p.id);
                      return (
                        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span>{p.name}{p.brand && ` · ${p.brand}`}{p.presentation && ` · ${p.presentation}`}
                            <span className="ml-2 rounded bg-white px-1.5 py-0.5 text-xs text-muted">{itm ? 'En la lista' : 'En catálogo'}</span>
                          </span>
                          {mode.kind === 'new' && !itm && (
                            <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => onSwitch({ kind: 'addExisting', product: p })}>
                              Usar este
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Section>

        {!readOnlyProduct && (
          <Section n={2} title="Clasificación">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Departamento" htmlFor="f-dep">
                <select id="f-dep" className="input" {...register('department_id', { onChange: () => setValue('category_id', '') })}>
                  <option value="">Sin departamento</option>
                  {data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <Field label="Categoría" htmlFor="f-cat" hint={!v.department_id ? 'Elige primero un departamento' : undefined}>
                {newCat === null ? (
                  <div className="flex gap-2">
                    <select id="f-cat" className="input" disabled={!v.department_id} {...register('category_id')}>
                      <option value="">{cats.length ? 'Sin categoría' : 'Sin categorías aún'}</option>
                      {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <Button variant="secondary" disabled={!v.department_id} onClick={() => setNewCat('')} aria-label="Nueva categoría" title="Nueva categoría" icon={<Plus className="size-4" />} />
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input className="input" autoFocus placeholder="Nombre de la categoría" value={newCat}
                      onChange={(e) => setNewCat(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void createCategory(); } }} />
                    <Button onClick={createCategory} disabled={!newCat.trim()}>Crear</Button>
                    <Button variant="ghost" onClick={() => setNewCat(null)}>✕</Button>
                  </div>
                )}
              </Field>
            </div>
          </Section>
        )}

        {showList && (
          <Section n={3} title="Compra">
            {listToggle && (
              <label className="mb-3 flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" {...register('add_to_list')} />
                Agregar también a la lista de compras
              </label>
            )}
            {inList && (
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Cantidad planificada (piezas) *" htmlFor="f-qty" error={errors.planned_qty?.message}
                  hint={bought > 0 ? `Ya se compraron ${bought} pzas: no puede ser menor.` : 'Piezas a comprar, no el tamaño de la presentación.'}>
                  <input id="f-qty" inputMode="numeric" className={cx('input num', errors.planned_qty && 'input-error')} placeholder="Ej. 24"
                    {...register('planned_qty', { onChange: (e) => setValue('planned_qty', e.target.value.replace(/\D/g, '')) })} />
                </Field>
                <div>
                  <span className="label">Prioridad *</span>
                  <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Prioridad">
                    {PRIORITIES.map((p) => (
                      <button key={p} type="button" role="radio" aria-checked={v.priority === p} onClick={() => setValue('priority', p)}
                        className={cx('h-10 rounded-lg border text-sm font-medium transition',
                          v.priority === p ? { alta: 'border-red-300 bg-red-50 text-red-700', media: 'border-amber-300 bg-amber-50 text-amber-800', baja: 'border-slate-400 bg-slate-100 text-slate-700' }[p]
                            : 'border-line text-muted hover:bg-slate-50')}>
                        {PRIORITY_LABEL[p]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </Section>
        )}

        <Section n={4} title={mode.kind === 'editProduct' ? 'Costo estimado general (catálogo)' : 'Costos'}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Costo unitario estimado (MXN)" htmlFor="f-cost" error={errors.unit_cost?.message} hint="Déjalo vacío si aún no lo conoces (no es lo mismo que $0).">
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">$</span>
                <input id="f-cost" inputMode="decimal" className={cx('input num pl-7', errors.unit_cost && 'input-error')} placeholder="Sin costo" {...register('unit_cost')} />
              </div>
            </Field>
            <div>
              <span className="label">El costo capturado es…</span>
              <div className="grid grid-cols-2 gap-2">
                {([['con_impuestos', 'Precio final (con impuestos)'], ['antes_impuestos', 'Antes de impuestos']] as const).map(([k, l]) => (
                  <label key={k} className={cx('flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm', v.price_mode === k ? 'border-primary bg-primary/5' : 'border-line')}>
                    <input type="radio" value={k} className="accent-primary" {...register('price_mode')} />{l}
                  </label>
                ))}
              </div>
            </div>
            <Field label="IVA" htmlFor="f-iva" error={errors.iva_rate?.message}>
              <div className="flex gap-2">
                <select id="f-iva" className="input" {...register('iva_kind')}>
                  <option value="tasa">Tasa (%)</option>
                  <option value="tasa_cero">Tasa 0%</option>
                  <option value="exento">Exento</option>
                </select>
                {v.iva_kind === 'tasa' && (
                  <div className="relative w-28 shrink-0">
                    <input inputMode="decimal" aria-label="Tasa de IVA" className="input num pr-7" {...register('iva_rate')} />
                    <span className="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted">%</span>
                  </div>
                )}
              </div>
            </Field>
            <Field label="IEPS" htmlFor="f-ieps" error={errors.ieps_value?.message}>
              <div className="flex gap-2">
                <select id="f-ieps" className="input" {...register('ieps_kind')}>
                  <option value="no_aplica">No aplica</option>
                  <option value="porcentaje">Porcentaje</option>
                  <option value="cuota_fija">Cuota fija por pieza</option>
                </select>
                {v.ieps_kind !== 'no_aplica' && (
                  <div className="relative w-28 shrink-0">
                    {v.ieps_kind === 'cuota_fija' && <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">$</span>}
                    <input inputMode="decimal" aria-label="Valor de IEPS" className={cx('input num', v.ieps_kind === 'cuota_fija' ? 'pl-6' : 'pr-7')} {...register('ieps_value')} />
                    {v.ieps_kind === 'porcentaje' && <span className="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted">%</span>}
                  </div>
                )}
              </div>
            </Field>
          </div>
          <p className="mt-3 flex gap-2 text-xs text-muted"><Info className="mt-0.5 size-3.5 shrink-0" />{TAX_DISCLAIMER} No se aplica IVA reducido automáticamente.</p>
          {mode.kind === 'editItem' && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" {...register('sync_catalog_cost')} />
              Usar también este costo como costo general del catálogo
            </label>
          )}
        </Section>

        {!readOnlyProduct && (
          <Section n={5} title="Proveedor y notas">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Proveedor" htmlFor="f-sup"><input id="f-sup" className="input" placeholder="Opcional" {...register('supplier')} /></Field>
              <Field label="Notas del producto" htmlFor="f-notes"><input id="f-notes" className="input" placeholder="Opcional" {...register('notes')} /></Field>
              {inList && showList && (
                <Field label="Notas de la compra" htmlFor="f-inotes" className="md:col-span-2"><input id="f-inotes" className="input" placeholder="Opcional" {...register('item_notes')} /></Field>
              )}
            </div>
          </Section>
        )}

        <Section n={6} title="Resumen del importe estimado">
          <div className="rounded-xl bg-slate-50 p-4">
            {!taxes.known ? (
              <p className="flex items-center gap-2 text-sm text-warning"><AlertTriangle className="size-4" /> Costo pendiente de cotizar: no se sumará como $0 al presupuesto.</p>
            ) : (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm md:grid-cols-4">
                <div><dt className="text-muted">Base</dt><dd className="num font-medium">{formatMXN(taxes.base)}</dd></div>
                <div><dt className="text-muted">IEPS</dt><dd className="num font-medium">{formatMXN(taxes.ieps)}</dd></div>
                <div><dt className="text-muted">IVA</dt><dd className="num font-medium">{formatMXN(taxes.iva)}</dd></div>
                <div><dt className="text-muted">Costo final / pza</dt><dd className="num font-semibold">{formatMXN(taxes.final)}</dd></div>
                {inList && showList && (
                  <div className="col-span-2 mt-2 border-t border-line pt-2 md:col-span-4">
                    <dt className="text-muted">Importe estimado ({qty || 0} pzas)</dt>
                    <dd className="num text-xl font-semibold text-ink">{formatMXN(taxes.final.times(qty))}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        </Section>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
