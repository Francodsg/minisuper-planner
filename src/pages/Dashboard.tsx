import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, PackageCheck, Plus, Wallet, HelpCircle, Archive } from 'lucide-react';
import type { ReactNode } from 'react';
import { useData } from '@/data/DataContext';
import { totalsByDepartment } from '@/lib/budget';
import { formatMXN } from '@/lib/money';
import { PRIORITIES, PRIORITY_LABEL } from '@/lib/types';
import { PageHeader } from '@/components/Layout';
import { useProductForm } from '@/components/ProductForm';
import { Button, PriorityBadge, ProgressBar, Skeleton, cx } from '@/components/ui';

function Stat({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'danger' | 'success' | 'warning'; icon?: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted md:text-sm">{label}</p>
        {icon && <span className="text-muted">{icon}</span>}
      </div>
      <p className={cx('num mt-1.5 text-lg font-semibold tracking-tight md:text-2xl',
        tone === 'danger' && 'text-danger', tone === 'success' && 'text-success', tone === 'warning' && 'text-warning')}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function BudgetAlert() {
  const { summary: s, settings } = useData();
  if (s.level === 'ok') return null;
  if (s.level === 'sin_presupuesto')
    return <Alert tone="info">Aún no configuras un presupuesto máximo. <Link to="/configuracion" className="font-medium underline">Configurarlo</Link></Alert>;
  const msg = {
    aviso1: `El costo proyectado ya alcanza el ${s.usedPct}% del presupuesto (aviso al ${settings?.warn_threshold_1 ?? 80}%).`,
    aviso2: `El costo proyectado ya alcanza el ${s.usedPct}% del presupuesto (aviso al ${settings?.warn_threshold_2 ?? 90}%).`,
    excedido: `El costo proyectado supera el presupuesto por ${formatMXN(s.overBudget)} (${s.usedPct}%).`,
  }[s.level];
  return <Alert tone={s.level === 'excedido' ? 'danger' : 'warning'}>{msg}</Alert>;
}

function Alert({ tone, children }: { tone: 'danger' | 'warning' | 'info'; children: ReactNode }) {
  const styles = { danger: 'border-red-200 bg-red-50 text-red-800', warning: 'border-amber-200 bg-amber-50 text-amber-900', info: 'border-blue-200 bg-blue-50 text-blue-900' };
  return <div className={cx('mb-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm', styles[tone])} role="status">
    <AlertTriangle className="mt-0.5 size-4 shrink-0" /><div>{children}</div>
  </div>;
}

export default function Dashboard() {
  const { summary: s, loading, rows, settings, products } = useData();
  const { open } = useProductForm();
  const tone = s.level === 'excedido' ? 'danger' : s.level === 'aviso1' || s.level === 'aviso2' ? 'warning' : 'success';
  const depts = totalsByDepartment(rows).slice(0, 6);
  const reminderDays = settings?.backup_reminder_days ?? 0;
  const lastBackup = settings?.last_backup_at ? new Date(settings.last_backup_at) : null;
  const backupDue = reminderDays > 0 && products.length > 0 &&
    (!lastBackup || Date.now() - lastBackup.getTime() > reminderDays * 86400000);

  if (loading) return <div className="space-y-4"><Skeleton className="h-10 w-60" /><div className="grid gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="h-64" /></div>;

  return (
    <div>
      <PageHeader title="Inicio" description="Resumen del presupuesto y avance de tu surtido inicial."
        actions={<Button className="max-md:!hidden" icon={<Plus className="size-4" />} onClick={() => open({})}>Agregar producto</Button>} />
      <BudgetAlert />
      {backupDue && (
        <Alert tone="info">
          {lastBackup ? `Tu último respaldo fue el ${lastBackup.toLocaleDateString('es-MX')}.` : 'Aún no has generado un respaldo.'}{' '}
          <Link to="/configuracion#respaldos" className="font-medium underline">Generar respaldo</Link>
        </Alert>
      )}
      {s.unknownCostCount > 0 && (
        <Alert tone="warning">
          Presupuesto incompleto: {s.unknownCostCount} {s.unknownCostCount === 1 ? 'producto no tiene' : 'productos no tienen'} costo. No se cuentan como gratuitos.{' '}
          <Link to="/lista?costo=desconocido" className="font-medium underline">Ver productos sin costo</Link>
        </Alert>
      )}

      {/* Tarjeta principal */}
      <div className="card mb-4 overflow-hidden">
        <div className="grid md:grid-cols-[1.2fr_2fr]">
          <div className="bg-gradient-to-br from-primary to-primary-dark p-5 text-white md:p-6">
            <p className="text-sm text-blue-100">Presupuesto disponible (proyectado)</p>
            <p className="num mt-1 text-3xl font-semibold tracking-tight md:text-4xl">{formatMXN(s.projectedAvailable)}</p>
            <p className="mt-1 text-sm text-blue-100">de {formatMXN(s.budget)} de presupuesto máximo</p>
            <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/20">
              <div className={cx('h-full rounded-full', s.level === 'excedido' ? 'bg-red-300' : 'bg-white')} style={{ width: `${Math.min(100, s.usedPct)}%` }} />
            </div>
            <p className="num mt-2 text-xs text-blue-100">{s.usedPct}% comprometido · {s.spentPct}% gastado</p>
          </div>
          <div className="grid grid-cols-2 gap-px bg-line md:grid-cols-3">
            {[
              ['Gastado realmente', formatMXN(s.spent), null],
              ['Pendiente estimado', formatMXN(s.pendingCost), s.unknownCostCount ? `+ ${s.unknownCostCount} sin costo` : null],
              ['Costo total proyectado', formatMXN(s.projected), null],
              ['Saldo tras lo gastado', formatMXN(s.balanceAfterSpent), null],
              ['Exceso de presupuesto', formatMXN(s.overBudget), null],
              ['Avance de compras', `${s.progressPct}%`, `${s.boughtPieces} de ${s.plannedPieces} pzas`],
            ].map(([l, v, sub]) => (
              <div key={l} className="bg-surface p-4">
                <p className="text-xs text-muted">{l}</p>
                <p className={cx('num mt-1 text-lg font-semibold', l === 'Exceso de presupuesto' && s.overBudget.gt(0) && 'text-danger')}>{v}</p>
                {sub && <p className="text-xs text-warning">{sub}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <Stat label="Productos registrados" value={s.count} sub={`${products.filter((p) => !p.archived).length} en catálogo`} icon={<ClipboardList className="size-4" />} />
        <Stat label="Pendientes" value={s.byStatus.pendiente} sub={`${s.byStatus.parcial} parcialmente comprados`} icon={<Wallet className="size-4" />} />
        <Stat label="Completados" value={s.byStatus.completado} tone="success" icon={<CheckCircle2 className="size-4" />} />
        <Stat label="Sin costo" value={s.unknownCostCount} tone={s.unknownCostCount ? 'warning' : undefined} sub="Pendientes de cotizar" icon={<HelpCircle className="size-4" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="card min-w-0 p-4 md:p-5">
          <h2 className="mb-3 font-semibold">Presupuesto por prioridad</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead><tr className="border-b border-line">
                <th className="th">Prioridad</th><th className="th text-right">Productos</th><th className="th text-right">Gastado</th>
                <th className="th text-right">Pendiente</th><th className="th text-right">Proyectado</th>
              </tr></thead>
              <tbody>
                {PRIORITIES.map((p) => {
                  const t = s.byPriority[p];
                  return (
                    <tr key={p} className="border-b border-line last:border-0">
                      <td className="td"><Link to={`/lista?prioridad=${p}`} aria-label={`Ver prioridad ${PRIORITY_LABEL[p]}`}><PriorityBadge p={p} /></Link></td>
                      <td className="td num text-right">{t.count}</td>
                      <td className="td num text-right">{formatMXN(t.spent)}</td>
                      <td className="td num text-right">{formatMXN(t.pendingCost)}{t.unknownCostCount > 0 && <span className="ml-1 text-xs text-warning" title="Productos sin costo">(+{t.unknownCostCount}?)</span>}</td>
                      <td className="td num text-right font-medium">{formatMXN(t.projected)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {depts.length > 0 && (
            <>
              <h3 className="mt-5 mb-2 text-sm font-semibold">Por departamento (proyectado)</h3>
              <ul className="space-y-2">
                {depts.map((d) => (
                  <li key={d.name}>
                    <div className="flex justify-between text-sm"><span>{d.name}</span><span className="num font-medium">{formatMXN(d.totals.projected)}</span></div>
                    <ProgressBar value={s.projected.gt(0) ? Number(d.totals.projected.div(s.projected).times(100).toFixed(0)) : 0} className="mt-1 h-1.5" />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="card min-w-0 p-4 md:p-5">
          <h2 className="mb-3 font-semibold">Accesos rápidos</h2>
          <div className="grid gap-2">
            <QuickLink onClick={() => open({})} icon={<Plus className="size-5" />} title="Agregar producto" text="Captura un nuevo artículo" />
            <QuickLink to="/lista" icon={<ClipboardList className="size-5" />} title="Ver pendientes" text={`${s.byStatus.pendiente + s.byStatus.parcial} con piezas por comprar`} />
            <QuickLink to="/comprados" icon={<PackageCheck className="size-5" />} title="Consultar comprados" text={`${s.byStatus.completado} completados`} />
            <QuickLink to="/catalogo" icon={<Archive className="size-5" />} title="Catálogo" text="Productos reutilizables" />
          </div>
          <div className="mt-5">
            <div className="mb-1 flex justify-between text-sm"><span className="text-muted">Avance general</span><span className="num font-medium">{s.progressPct}%</span></div>
            <ProgressBar value={s.progressPct} tone={tone === 'danger' ? 'primary' : 'success'} />
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickLink({ to, onClick, icon, title, text }: { to?: string; onClick?: () => void; icon: ReactNode; title: string; text: string }) {
  const inner = (
    <>
      <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
      <span className="flex-1 text-left"><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-muted">{text}</span></span>
      <ArrowRight className="size-4 text-muted" />
    </>
  );
  const cls = 'flex min-h-14 items-center gap-3 rounded-xl border border-line px-3 py-2 transition hover:border-primary/40 hover:bg-primary/5';
  return to ? <Link to={to} className={cls}>{inner}</Link> : <button onClick={onClick} className={cls}>{inner}</button>;
}
