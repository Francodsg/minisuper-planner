import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileJson, FileSpreadsheet, FolderTree, LogOut, Save, Upload, User } from 'lucide-react';
import { useData } from '@/data/DataContext';
import { useAuth } from '@/data/AuthContext';
import * as api from '@/data/api';
import { friendlyError } from '@/data/supabase';
import { buildBackup, download, rowsToCsv, validateBackup } from '@/lib/backup';
import { formatMXN, parseMoneyInput } from '@/lib/money';
import { TAX_DISCLAIMER } from '@/lib/tax';
import { PageHeader } from '@/components/Layout';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { Button, Field, cx } from '@/components/ui';
import type { UserSettings } from '@/lib/types';

function Card({ id, title, description, children }: { id?: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card p-4 md:p-6">
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function Settings() {
  const data = useData();
  const { session, signOut } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const s = data.settings;
  const [budget, setBudget] = useState('');
  const [t1, setT1] = useState('80');
  const [t2, setT2] = useState('90');
  const [reminder, setReminder] = useState('7');
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!s) return;
    setBudget(Number(s.budget_max).toFixed(2));
    setT1(String(s.warn_threshold_1)); setT2(String(s.warn_threshold_2)); setReminder(String(s.backup_reminder_days));
  }, [s]);

  const budgetErr = parseMoneyInput(budget) === null ? 'Indica un importe válido' : '';
  const tErr = !/^\d+$/.test(t1) || !/^\d+$/.test(t2) || Number(t1) < 1 || Number(t2) > 100 || Number(t1) >= Number(t2) ? 'Los avisos deben ser enteros, 1–100, y el primero menor que el segundo' : '';

  async function saveSettings(patch: Partial<UserSettings>, msg = 'Configuración guardada') {
    try { await api.updateSettings(patch); await data.refresh(); toast.success(msg); } catch (e) { toast.error(friendlyError(e)); }
  }
  async function saveBudget() {
    if (budgetErr || tErr) return;
    setSaving(true);
    await saveSettings({ budget_max: parseMoneyInput(budget)!, warn_threshold_1: Number(t1), warn_threshold_2: Number(t2) }, 'Presupuesto actualizado');
    setSaving(false);
  }

  async function exportJson() {
    try {
      const snap = await api.loadAll(); // copia fresca desde la base de datos
      const stamp = new Date().toISOString().slice(0, 10);
      download(`minisuper-respaldo-${stamp}.json`, JSON.stringify(buildBackup(snap), null, 2), 'application/json');
      await api.updateSettings({ last_backup_at: new Date().toISOString() });
      await data.refresh();
      toast.success('Respaldo generado');
    } catch (e) { toast.error(friendlyError(e)); }
  }
  function exportCsv() {
    download(`minisuper-lista-${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv(data.rows), 'text/csv;charset=utf-8');
    toast.success('Lista exportada a CSV');
  }
  async function importJson(file: File) {
    let parsed: unknown;
    try { parsed = JSON.parse(await file.text()); } catch { toast.error('El archivo no contiene JSON válido.'); return; }
    const check = validateBackup(parsed);
    if (!check.ok) { toast.error(check.error!); return; }
    const c = check.counts!;
    const ok = await confirm({ title: 'Restaurar respaldo', danger: true, confirm: 'Reemplazar mis datos',
      text: <div className="space-y-2">
        <p>Se <b>reemplazarán todos tus datos actuales</b> por el contenido del respaldo:</p>
        <p className="num text-muted">{c.products} productos · {c.list_items} artículos planificados · {c.purchases} movimientos · {c.categories} categorías</p>
        <p>Te recomendamos exportar un respaldo actual antes de continuar.</p>
      </div> });
    if (!ok) return;
    setImporting(true);
    try { await api.restoreBackup(parsed); await data.refresh(); toast.success('Respaldo restaurado'); }
    catch (e) { toast.error(friendlyError(e)); }
    finally { setImporting(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  const last = s?.last_backup_at ? new Date(s.last_backup_at) : null;

  return (
    <div>
      <PageHeader title="Configuración" description="Presupuesto, preferencias, respaldos y cuenta." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Presupuesto" description="Presupuesto máximo y umbrales de aviso sobre el costo proyectado.">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Presupuesto máximo (MXN)" htmlFor="b" error={budgetErr} className="md:col-span-3">
              <div className="relative"><span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">$</span>
                <input id="b" inputMode="decimal" className={cx('input num pl-7 text-lg', budgetErr && 'input-error')} value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
            </Field>
            <Field label="Primer aviso (%)" htmlFor="t1"><input id="t1" inputMode="numeric" className="input num" value={t1} onChange={(e) => setT1(e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label="Segundo aviso (%)" htmlFor="t2"><input id="t2" inputMode="numeric" className="input num" value={t2} onChange={(e) => setT2(e.target.value.replace(/\D/g, ''))} /></Field>
            <div className="flex items-end"><Button className="w-full" loading={saving} disabled={!!budgetErr || !!tErr} icon={<Save className="size-4" />} onClick={saveBudget}>Guardar</Button></div>
          </div>
          {tErr && <p className="err">{tErr}</p>}
          <p className="hint mt-3">Siempre se avisa al superar el 100%. Actual: proyectado {formatMXN(data.summary.projected)} ({data.summary.usedPct}%).</p>
        </Card>

        <Card title="Preferencias visuales">
          <div className="space-y-4">
            <Field label="Vista predeterminada de la lista" htmlFor="dv" hint="“Automática” usa tabla en computadora y tarjetas en celular.">
              <select id="dv" className="input" value={s?.default_view ?? 'auto'} onChange={(e) => {
                try { localStorage.removeItem('msp.view'); } catch { /* preferencia local */ }
                void saveSettings({ default_view: e.target.value as UserSettings['default_view'] });
              }}>
                <option value="auto">Automática</option><option value="tabla">Tabla</option><option value="tarjetas">Tarjetas</option>
              </select>
            </Field>
            <Link to="/departamentos" className="flex items-center gap-2 text-sm font-medium text-primary hover:underline"><FolderTree className="size-4" /> Administrar departamentos y categorías</Link>
          </div>
        </Card>

        <Card id="respaldos" title="Respaldos y exportación" description={last ? `Último respaldo: ${last.toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' })}` : 'Aún no has generado ningún respaldo.'}>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button variant="secondary" className="h-11" icon={<FileJson className="size-4" />} onClick={exportJson}>Respaldo JSON</Button>
            <Button variant="secondary" className="h-11" icon={<FileSpreadsheet className="size-4" />} onClick={exportCsv}>Lista a CSV</Button>
            <Button variant="secondary" className="h-11" loading={importing} icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>Restaurar</Button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); }} />
          </div>
          <Field label="Recordarme generar un respaldo cada" htmlFor="rem" className="mt-4" hint="Se muestra un aviso en Inicio cuando toca respaldar. 0 = sin recordatorio.">
            <div className="flex gap-2">
              <select id="rem" className="input" value={reminder} onChange={(e) => { setReminder(e.target.value); void saveSettings({ backup_reminder_days: Number(e.target.value) }, 'Recordatorio actualizado'); }}>
                {[0, 1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d === 0 ? 'Nunca' : d === 1 ? 'Cada día' : `Cada ${d} días`}</option>)}
              </select>
            </div>
          </Field>
          <p className="hint mt-3 flex gap-1"><Download className="size-3.5" /> El CSV usa UTF-8 con BOM para abrirse correctamente en Excel.</p>
        </Card>

        <Card title="Cuenta">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-slate-100"><User className="size-5 text-muted" /></div>
            <div className="min-w-0 flex-1"><p className="truncate font-medium">{session?.user.email}</p>
              <p className="text-xs text-muted">Cuenta creada el {session?.user.created_at ? new Date(session.user.created_at).toLocaleDateString('es-MX') : '—'}</p></div>
          </div>
          <p className="hint mt-4">Tus datos se guardan en la nube y se sincronizan automáticamente entre tus dispositivos.</p>
          <p className="hint mt-2">{TAX_DISCLAIMER}</p>
          <Button variant="secondary" className="mt-4 text-danger" icon={<LogOut className="size-4" />} onClick={() => void signOut()}>Cerrar sesión</Button>
        </Card>
      </div>
    </div>
  );
}
