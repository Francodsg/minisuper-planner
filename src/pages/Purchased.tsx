import { useMemo, useState } from 'react';
import { History, PackageCheck, Search } from 'lucide-react';
import { useData } from '@/data/DataContext';
import { dec, formatMXN, sum } from '@/lib/money';
import { matchesQuery } from '@/lib/search';
import { totalsOf, type PlanRow } from '@/lib/budget';
import { PageHeader } from '@/components/Layout';
import { usePurchases } from '@/components/PurchaseDialog';
import { Button, EmptyState, PriorityBadge, Skeleton, StatusBadge } from '@/components/ui';

function unitReal(r: PlanRow) {
  // costo unitario real: único si todas las compras tuvieron el mismo precio; si no, promedio ponderado
  const costs = new Set(r.purchases.map((p) => dec(p.unit_cost_final).toFixed(2)));
  if (costs.size <= 1) return { value: r.purchases[0] ? dec(r.purchases[0].unit_cost_final) : null, avg: false };
  return { value: r.bought ? r.spent.div(r.bought) : null, avg: true };
}
const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function Purchased() {
  const data = useData();
  const purchases = usePurchases();
  const [q, setQ] = useState('');
  const [withPartial, setWithPartial] = useState(false);
  const rows = useMemo(() => data.rows
    .filter((r) => r.status === 'completado' || (withPartial && r.status === 'parcial'))
    .filter((r) => matchesQuery(q, [r.product.name, r.product.brand, r.product.supplier, r.department?.name, r.category?.name, ...r.purchases.map((p) => p.supplier)]))
    .sort((a, b) => (b.lastPurchaseAt ?? '').localeCompare(a.lastPurchaseAt ?? '')), [data.rows, q, withPartial]);
  const t = totalsOf(rows);
  const suppliers = (r: PlanRow) => [...new Set(r.purchases.map((p) => p.supplier).filter(Boolean))].join(', ') || r.product.supplier || '—';

  if (data.loading) return <div className="space-y-3"><Skeleton className="h-10 w-60" />{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>;

  return (
    <div>
      <PageHeader title="Comprados" description="Artículos completamente comprados, con su historial de movimientos." />
      <div className="card mb-4 flex flex-col gap-2 p-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input type="search" className="input pl-9" placeholder="Buscar producto, marca o proveedor…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar comprados" />
        </div>
        <button className="chip" aria-pressed={withPartial} onClick={() => setWithPartial((v) => !v)}>Incluir parcialmente comprados</button>
        <p className="num text-sm text-muted md:ml-2">{rows.length} artículos · gastado <b className="text-ink">{formatMXN(t.spent)}</b></p>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<PackageCheck className="size-6" />} title="Aún no hay productos comprados"
          text="Cuando registres la compra completa de un artículo, aparecerá aquí con su historial." />
      ) : (
        <>
          {/* Tabla (escritorio) */}
          <div className="card hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px]">
              <thead className="border-b border-line bg-slate-50/80"><tr>
                <th className="th">Producto</th><th className="th">Departamento / categoría</th><th className="th text-right">Planif. / compr.</th>
                <th className="th">Fecha de compra</th><th className="th text-right">Costo unit. real</th><th className="th text-right">Total gastado</th>
                <th className="th">Proveedor</th><th className="th">Notas</th><th className="th" />
              </tr></thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const u = unitReal(r);
                  return (
                    <tr key={r.item.id} className="hover:bg-slate-50/70">
                      <td className="td"><p className="font-medium">{r.product.name}</p><p className="text-xs text-muted">{r.product.brand ?? '—'}</p>
                        <div className="mt-1 flex gap-1"><PriorityBadge p={r.item.priority} />{r.status !== 'completado' && <StatusBadge s={r.status} />}</div></td>
                      <td className="td"><p>{r.department?.name ?? '—'}</p><p className="text-xs text-muted">{r.category?.name ?? 'Sin categoría'}</p></td>
                      <td className="td num text-right">{r.planned} / {r.bought}</td>
                      <td className="td"><p>{fmtDate(r.lastPurchaseAt)}</p>{r.purchases.length > 1 && <p className="text-xs text-muted">{r.purchases.length} movimientos</p>}</td>
                      <td className="td num text-right">{formatMXN(u.value)}{u.avg && <p className="text-xs text-muted">promedio</p>}</td>
                      <td className="td num text-right font-semibold">{formatMXN(r.spent)}</td>
                      <td className="td max-w-[140px] truncate">{suppliers(r)}</td>
                      <td className="td max-w-[160px] truncate text-muted">{r.purchases.map((p) => p.notes).filter(Boolean).join(' · ') || '—'}</td>
                      <td className="td text-right"><Button size="sm" variant="secondary" icon={<History className="size-4" />} onClick={() => purchases.history(r.item.id)}>Historial</Button></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-line bg-slate-50/80"><tr>
                <td className="td font-medium" colSpan={5}>Total</td>
                <td className="td num text-right font-semibold">{formatMXN(sum(rows.map((r) => r.spent)))}</td><td colSpan={3} />
              </tr></tfoot>
            </table>
          </div>
          {/* Tarjetas (móvil) */}
          <div className="space-y-3 md:hidden">
            {rows.map((r) => {
              const u = unitReal(r);
              return (
                <article key={r.item.id} className="card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div><h3 className="font-semibold">{r.product.name}</h3><p className="text-sm text-muted">{r.product.brand ?? 'Sin marca'} · {r.department?.name ?? '—'}{r.category && ` › ${r.category.name}`}</p></div>
                    <StatusBadge s={r.status} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div><dt className="text-xs text-muted">Compradas</dt><dd className="num">{r.bought} de {r.planned} pzas</dd></div>
                    <div><dt className="text-xs text-muted">Fecha</dt><dd>{fmtDate(r.lastPurchaseAt)}</dd></div>
                    <div><dt className="text-xs text-muted">Costo unit. real{u.avg && ' (prom.)'}</dt><dd className="num">{formatMXN(u.value)}</dd></div>
                    <div><dt className="text-xs text-muted">Total gastado</dt><dd className="num font-semibold">{formatMXN(r.spent)}</dd></div>
                    <div className="col-span-2"><dt className="text-xs text-muted">Proveedor</dt><dd>{suppliers(r)}</dd></div>
                  </dl>
                  <Button variant="secondary" className="mt-3 h-11 w-full" icon={<History className="size-4" />} onClick={() => purchases.history(r.item.id)}>Historial y correcciones</Button>
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
