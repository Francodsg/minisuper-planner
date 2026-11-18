import { useRef, useState } from 'react';
import { FileUp, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useData } from '@/data/DataContext';
import * as api from '@/data/api';
import { friendlyError } from '@/data/supabase';
import { parseImport, planImport, type ImportPlan, type ParsedImport } from '@/lib/importer';
import { PRIORITIES, PRIORITY_LABEL } from '@/lib/types';
import { Button, Modal, PriorityBadge } from './ui';
import { useToast } from './Toast';

/** Importa productos desde un CSV y los agrega al catálogo y a la lista de compras. */
export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const data = useData();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  function reset() { setParsed(null); setPlan(null); setFileName(''); setProgress(''); if (fileRef.current) fileRef.current.value = ''; }
  function close() { if (busy) return; reset(); onClose(); }

  async function onFile(f: File) {
    if (/\.xlsx?$/i.test(f.name)) {
      toast.error('Guarda primero el archivo de Excel como “CSV UTF-8 (delimitado por comas)” y elige ese archivo.');
      return;
    }
    const p = parseImport(await f.text());
    setFileName(f.name);
    setParsed(p);
    setPlan(p.rows.length ? planImport(p.rows, data) : null);
  }

  async function go() {
    if (!plan || !data.listId) return;
    setBusy(true);
    try {
      const r = await api.runImport(plan, data.listId, setProgress);
      await data.refresh();
      toast.success(`Importación lista: ${r.items} productos agregados a la lista`);
      reset(); onClose();
    } catch (e) {
      toast.error(`${friendlyError(e)} — puedes volver a importar el mismo archivo: lo ya creado no se duplica.`);
      await data.refresh();
    } finally { setBusy(false); setProgress(''); }
  }

  const toAdd = plan ? [...plan.newProducts, ...plan.reuseProducts.map((x) => x.row)] : [];
  const byPriority = PRIORITIES.map((p) => [p, toAdd.filter((r) => r.priority === p).length] as const);

  return (
    <Modal open={open} onClose={close} title="Importar productos" size="lg"
      subtitle="Agrega muchos productos de una vez desde un archivo CSV (Excel → Guardar como → CSV UTF-8)."
      footer={<>
        <Button variant="secondary" onClick={close} disabled={busy}>Cancelar</Button>
        <Button onClick={go} loading={busy} disabled={!plan || toAdd.length === 0}>
          {toAdd.length ? `Importar ${toAdd.length} productos` : 'Importar'}
        </Button>
      </>}>
      <div className="space-y-4 text-sm">
        <div className="rounded-xl border border-dashed border-line p-5 text-center">
          <FileUp className="mx-auto mb-2 size-6 text-primary" />
          <p className="font-medium">{fileName || 'Elige un archivo .csv'}</p>
          <p className="mt-1 text-xs text-muted">Columnas: Producto y Cantidad (obligatorias); Prioridad, Departamento, Categoría, Marca, Presentación, Costo unitario, Proveedor y Notas (opcionales).</p>
          <Button variant="secondary" className="mt-3" onClick={() => fileRef.current?.click()} disabled={busy}>Seleccionar archivo</Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
        </div>

        {parsed && parsed.errors.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
            <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" /> {parsed.errors.length} fila(s) se omitirán:</p>
            <ul className="mt-1 list-disc pl-5 text-xs">{parsed.errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul>
            {parsed.errors.length > 8 && <p className="mt-1 text-xs">…y {parsed.errors.length - 8} más.</p>}
          </div>
        )}

        {plan && (
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-4 text-success" /> Resumen</p>
            <ul className="mt-2 grid gap-1 md:grid-cols-2">
              <li><b className="num">{toAdd.length}</b> productos se agregarán a la lista</li>
              <li><b className="num">{plan.newProducts.length}</b> productos nuevos en el catálogo</li>
              <li><b className="num">{plan.newDepartments.length}</b> departamentos nuevos</li>
              <li><b className="num">{plan.newCategories.length}</b> categorías nuevas</li>
              {plan.alreadyInList.length > 0 && <li className="text-muted"><b className="num">{plan.alreadyInList.length}</b> ya estaban en la lista (se omiten)</li>}
              {plan.duplicatedInFile.length > 0 && <li className="text-muted"><b className="num">{plan.duplicatedInFile.length}</b> repetidos en el archivo (se omiten)</li>}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              {byPriority.map(([p, n]) => <span key={p} className="flex items-center gap-1"><PriorityBadge p={p} /><span className="num">{n}</span></span>)}
            </div>
            {toAdd.some((r) => r.cost === null) && (
              <p className="mt-3 text-xs text-warning">{toAdd.filter((r) => r.cost === null).length} productos no tienen costo: aparecerán como “sin costo” hasta que lo captures.</p>
            )}
            <p className="mt-2 text-xs text-muted">Prioridades del archivo: {PRIORITIES.map((p) => PRIORITY_LABEL[p]).join(', ')}. También se aceptan “Apertura”, “Después” y “Mucho después”.</p>
          </div>
        )}
        {busy && <p className="text-center font-medium text-primary" role="status">{progress || 'Importando…'}</p>}
      </div>
    </Modal>
  );
}
