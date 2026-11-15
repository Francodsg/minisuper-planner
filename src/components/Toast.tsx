import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { cx } from './ui';

type Tone = 'success' | 'error' | 'info';
interface ToastItem { id: number; tone: Tone; text: string; action?: { label: string; run: () => void | Promise<void> } }
interface ToastApi {
  success: (text: string, action?: ToastItem['action']) => void;
  error: (text: string) => void;
  info: (text: string) => void;
}
const Ctx = createContext<ToastApi | null>(null);
let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback((tone: Tone, text: string, action?: ToastItem['action']) => {
    const id = ++counter;
    setItems((xs) => [...xs.slice(-3), { id, tone, text, action }]);
    setTimeout(() => dismiss(id), action ? 8000 : 4000);
  }, [dismiss]);
  const api: ToastApi = {
    success: (t, a) => push('success', t, a),
    error: (t) => push('error', t),
    info: (t) => push('info', t),
  };
  const icons = { success: <CheckCircle2 className="size-5 text-success" />, error: <AlertTriangle className="size-5 text-danger" />, info: <Info className="size-5 text-primary" /> };
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:right-6 md:left-auto md:items-end" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto flex w-full max-w-sm animate-slide-up items-center gap-3 rounded-xl border bg-white px-4 py-3 shadow-lg',
            t.tone === 'error' ? 'border-red-200' : 'border-line')}>
            {icons[t.tone]}
            <p className="flex-1 text-sm">{t.text}</p>
            {t.action && (
              <button className="text-sm font-semibold text-primary hover:underline" onClick={async () => { dismiss(t.id); await t.action!.run(); }}>
                {t.action.label}
              </button>
            )}
            <button aria-label="Cerrar aviso" className="text-muted hover:text-ink" onClick={() => dismiss(t.id)}><X className="size-4" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast fuera de ToastProvider');
  return c;
}
