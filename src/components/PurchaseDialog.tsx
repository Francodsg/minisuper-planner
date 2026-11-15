import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { History, Pencil, RotateCcw, Undo2 } from 'lucide-react';
import { useData } from '@/data/DataContext';
import * as api from '@/data/api';
import { friendlyError } from '@/data/supabase';
import { dec, formatMXN, parseMoneyInput } from '@/lib/money';
import type { Purchase } from '@/lib/types';
import { Button, Field, Modal, ProgressBar, StatusBadge, cx } from './ui';
import { useToast } from './Toast';
import { useConfirm } from './Confirm';

interface Api {
  register: (itemId: string) => void;
  history: (itemId: string) => void;
}
const Ctx = createContext<Api | null>(null);

export function PurchaseDialogProvider({ children }: { children: ReactNode }) {
  const [reg, setReg] = useState<{ itemId: string; edit?: Purchase; requestId: string } | null>(null);
  const [hist, setHist] = useState<string | null>(null);
  const register = useCallback((itemId: string) => setReg({ itemId, requestId: crypto.randomUUID() }), []);
  const history = useCallback((itemId: string) => setHist(itemId), []);
  return (
    <Ctx.Provider value={{ register, history }}>
      {children}
      {reg && <RegisterDialog key={reg.requestId} {...reg} onClose={() => setReg(null)} />}
      {hist && <HistoryDialog itemId={hist} onClose={() => setHist(null)}
        onEdit={(p) => setReg({ itemId: hist, edit: p, requestId: crypto.randomUUID() })}
        onRegister={() => register(hist)} />}
    </Ctx.Provider>
  );
}

export function usePurchases() {
  const c = useContext(Ctx);
  if (!c) throw new Error('usePurchases fuera de su proveedor');
  return c;
}

function localDateTime(iso?: string) {
  const d = iso ? new Date(iso) : new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function RegisterDialog({ itemId, edit, requestId, onClose }: { itemId: string; edit?: Purchase; requestId: string; onClose: () => void }) {
  const data = useData();
  const toast = useToast();
  const row = data.rows.find((r) => r.item.id === itemId);
  const maxQty = row ? row.pending + (edit?.quantity ?? 0) : 0;
  const [qty, setQty] = useState(String(edit?.quantity ?? row?.pending ?? ''));
  const [cost, setCost] = useState(edit ? String(edit.unit_cost_final) : row?.unitFinal ? row.unitFinal.toFixed(2) : '');
  const [when, setWhen] = useState(localDateTime(edit?.purchased_at));
  const [supplier, setSupplier] = useState(edit?.supplier ?? row?.product.supplier ?? '');
  const [notes, setNotes] = useState(edit?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  if (!row) return null;
  const q = /^\d+$/.test(qty) ? Number(qty) : NaN;
  const qtyErr = !Number.isInteger(q) || q <= 0 ? 'Indica un entero mayor a 0'
    : q > maxQty ? `No puede superar lo pendiente (${maxQty} pzas). Modifica primero la cantidad planificada.` : '';
  const costParsed = parseMoneyInput(cost);
  const costErr = costParsed === null ? 'Indica el costo unitario final pagado (con impuestos)' : '';
  const total = !qtyErr && !costErr ? dec(costParsed).toDecimalPlaces(2).times(q) : null;

  async function save() {
    setTouched(true);
    if (qtyErr || costErr) return;
    setSaving(true);
    const input: api.PurchaseInput = {
      quantity: q, unit_cost_final: costParsed!, purchased_at: new Date(when).toISOString(),
      supplier: supplier.trim() || null, notes: notes.trim() || null,
    };
    try {
      // requestId es fijo por apertura del diálogo: un reintento o doble clic no duplica la compra
      if (edit) await api.correctPurchase(edit.id, input);
      else await api.registerPurchase(itemId, input, requestId);
      await data.refresh();
      const done = !edit && q === row!.pending;
      toast.success(edit ? 'Movimiento corregido' : done ? `“${row!.product.name}” completado` : `Compra registrada: ${q} pzas`);
      onClose();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} size="md" title={edit ? 'Corregir compra' : 'Registrar compra'}
      subtitle={`${row.product.name}${row.product.brand ? ` · ${row.product.brand}` : ''}`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant="success" loading={saving} onClick={save}>{edit ? 'Guardar corrección' : 'Registrar compra'}</Button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center text-sm">
          <div><p className="text-muted">Planificadas</p><p className="num text-lg font-semibold">{row.planned}</p></div>
          <div><p className="text-muted">Compradas</p><p className="num text-lg font-semibold">{row.bought}</p></div>
          <div><p className="text-muted">Pendientes</p><p className="num text-lg font-semibold text-primary">{row.pending}</p></div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Piezas compradas *" htmlFor="pq" error={touched ? qtyErr : undefined} hint={`Máximo ${maxQty} pzas`}>
            <div className="flex gap-2">
              <input id="pq" inputMode="numeric" autoFocus className={cx('input num', touched && qtyErr && 'input-error')} value={qty}
                onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} />
              {!edit && <Button variant="secondary" onClick={() => setQty(String(row.pending))}>Todo</Button>}
            </div>
          </Field>
          <Field label="Costo unitario real final (MXN) *" htmlFor="pc" error={touched ? costErr : undefined}
            hint={row.unitFinal ? `Estimado: ${formatMXN(row.unitFinal)} con impuestos` : 'Sin costo estimado'}>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">$</span>
              <input id="pc" inputMode="decimal" className={cx('input num pl-7', touched && costErr && 'input-error')} value={cost} onChange={(e) => setCost(e.target.value)} />
            </div>
          </Field>
          <Field label="Fecha y hora" htmlFor="pw"><input id="pw" type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
          <Field label="Proveedor" htmlFor="ps"><input id="ps" className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Opcional" /></Field>
          <Field label="Notas" htmlFor="pn" className="md:col-span-2"><input id="pn" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" /></Field>
        </div>
        <div className="flex items-center justify-between rounded-xl border border-line px-4 py-3">
          <span className="text-sm text-muted">Total de este movimiento</span>
          <span className="num text-xl font-semibold">{total ? formatMXN(total) : '—'}</span>
        </div>
      </div>
    </Modal>
  );
}

function HistoryDialog({ itemId, onClose, onEdit, onRegister }: { itemId: string; onClose: () => void; onEdit: (p: Purchase) => void; onRegister: () => void }) {
  const data = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const row = data.rows.find((r) => r.item.id === itemId);
  const all = useMemo(() => data.purchases.filter((p) => p.list_item_id === itemId).sort((a, b) => b.purchased_at.localeCompare(a.purchased_at)), [data.purchases, itemId]);
  if (!row) return null;

  async function revert(p: Purchase) {
    const ok = await confirm({ title: 'Revertir compra', danger: true, confirm: 'Revertir',
      text: <>Se revertirán <b>{p.quantity} pzas</b> ({formatMXN(p.total)}). Las piezas regresarán a pendientes. El movimiento queda en el historial como revertido.</> });
    if (!ok) return;
    try {
      await api.voidPurchase(p.id, 'Revertido por el usuario');
      await data.refresh();
      toast.success('Compra revertida', { label: 'Deshacer', run: async () => {
        try { await api.unvoidPurchase(p.id); await data.refresh(); } catch (e) { toast.error(friendlyError(e)); }
      } });
    } catch (e) { toast.error(friendlyError(e)); }
  }
  async function restore(p: Purchase) {
    try { await api.unvoidPurchase(p.id); await data.refresh(); toast.success('Movimiento restaurado'); }
    catch (e) { toast.error(friendlyError(e)); }
  }

  return (
    <Modal open onClose={onClose} size="lg" title="Historial de compras" subtitle={`${row.product.name}${row.product.brand ? ` · ${row.product.brand}` : ''}`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        {row.pending > 0 && <Button variant="success" onClick={onRegister}>Registrar compra</Button>}
      </>}>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <StatusBadge s={row.status} />
        <span className="num text-sm">{row.bought} / {row.planned} pzas · pendientes {row.pending}</span>
        <span className="num text-sm text-muted">Gastado: <b className="text-ink">{formatMXN(row.spent)}</b></span>
        <ProgressBar value={row.progress} tone={row.status === 'completado' ? 'success' : 'primary'} className="md:max-w-40" />
      </div>
      {all.length === 0 ? (
        <p className="flex items-center gap-2 py-8 text-center text-sm text-muted"><History className="size-4" /> Aún no hay movimientos.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {all.map((p) => (
            <li key={p.id} className={cx('flex flex-wrap items-center gap-3 px-4 py-3', p.voided_at && 'bg-slate-50 text-muted')}>
              <div className="min-w-0 flex-1">
                <p className={cx('num text-sm font-medium', p.voided_at && 'line-through')}>
                  {p.quantity} pzas × {formatMXN(p.unit_cost_final)} = {formatMXN(p.total)}
                </p>
                <p className="text-xs text-muted">
                  {new Date(p.purchased_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}
                  {p.supplier && ` · ${p.supplier}`}{p.notes && ` · ${p.notes}`}
                  {p.voided_at && ` · Revertido el ${new Date(p.voided_at).toLocaleDateString('es-MX')}`}
                  {p.updated_at !== p.created_at && !p.voided_at && ' · Corregido'}
                </p>
              </div>
              {p.voided_at ? (
                <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => restore(p)}>Restaurar</Button>
              ) : (
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" />} onClick={() => onEdit(p)}>Corregir</Button>
                  <Button size="sm" variant="ghost" className="text-danger" icon={<RotateCcw className="size-3.5" />} onClick={() => revert(p)}>Revertir</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
