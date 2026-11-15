import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, Modal } from './ui';

interface Opts { title: string; text: ReactNode; confirm?: string; danger?: boolean }
const Ctx = createContext<((o: Opts) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(Opts & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: Opts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  return (
    <Ctx.Provider value={ask}>
      {children}
      <Modal open={!!state} onClose={() => close(false)} title={state?.title ?? ''} size="sm"
        footer={<>
          <Button variant="secondary" onClick={() => close(false)}>Cancelar</Button>
          <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{state?.confirm ?? 'Confirmar'}</Button>
        </>}>
        <div className="flex gap-3">
          {state?.danger && <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />}
          <div className="text-sm text-ink">{state?.text}</div>
        </div>
      </Modal>
    </Ctx.Provider>
  );
}

export function useConfirm() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useConfirm fuera de ConfirmProvider');
  return c;
}
