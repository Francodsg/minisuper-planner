import { forwardRef, useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2, X } from 'lucide-react';
import type { Priority, PurchaseStatus } from '@/lib/types';
import { PRIORITY_LABEL, STATUS_LABEL } from '@/lib/types';

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-dark shadow-sm',
  secondary: 'bg-white text-ink border border-line hover:bg-slate-50',
  ghost: 'text-ink hover:bg-slate-100',
  danger: 'bg-danger text-white hover:bg-red-700 shadow-sm',
  success: 'bg-success text-white hover:bg-green-700 shadow-sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode;
}>(function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
  const sizes = { sm: 'h-8 px-2.5 text-sm gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-5 text-base gap-2' };
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cx('inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant], sizes[size], className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label}
      className={cx('inline-flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-slate-100 hover:text-ink disabled:opacity-40', className)}
      {...rest}>
      {children}
    </button>
  );
}

const PRIORITY_STYLE: Record<Priority, string> = {
  alta: 'bg-red-50 text-red-700 ring-red-200',
  media: 'bg-amber-50 text-amber-800 ring-amber-200',
  baja: 'bg-slate-100 text-slate-600 ring-slate-300',
};
const PRIORITY_DOT: Record<Priority, string> = { alta: 'bg-red-500', media: 'bg-amber-500', baja: 'bg-slate-400' };

export function PriorityBadge({ p }: { p: Priority }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', PRIORITY_STYLE[p])}>
      <span className={cx('size-1.5 rounded-full', PRIORITY_DOT[p])} aria-hidden />
      {PRIORITY_LABEL[p]}
    </span>
  );
}

const STATUS_STYLE: Record<PurchaseStatus, string> = {
  pendiente: 'bg-slate-100 text-slate-700',
  parcial: 'bg-blue-50 text-blue-700',
  completado: 'bg-green-50 text-green-700',
};
export function StatusBadge({ s }: { s: PurchaseStatus }) {
  return <span className={cx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', STATUS_STYLE[s])}>
    {s === 'parcial' ? 'Parcial' : STATUS_LABEL[s]}
  </span>;
}

export function ProgressBar({ value, tone = 'primary', className }: { value: number; tone?: 'primary' | 'success' | 'warning' | 'danger'; className?: string }) {
  const tones = { primary: 'bg-primary', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' };
  return (
    <div className={cx('h-2 w-full overflow-hidden rounded-full bg-slate-100', className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full transition-all duration-300', tones[tone])} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">{icon}</div>
      <h3 className="text-base font-semibold">{title}</h3>
      {text && <p className="max-w-md text-sm text-muted">{text}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-slate-200/70', className)} />;
}

/**
 * Modal: en escritorio ventana centrada (o panel lateral), en móvil pantalla completa.
 */
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', side = false }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl'; side?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  const widths = { sm: 'md:max-w-md', md: 'md:max-w-xl', lg: 'md:max-w-3xl', xl: 'md:max-w-5xl' };
  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in md:items-center md:justify-center md:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onClose} />
      <div className={cx('relative flex h-full w-full flex-col bg-surface animate-slide-up md:shadow-xl',
        side ? 'md:ml-auto md:h-[calc(100%+3rem)] md:-mr-6 md:max-w-2xl md:rounded-none'
             : cx('md:h-auto md:max-h-[90vh] md:rounded-2xl', widths[size]))}>
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 md:px-6 md:py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          <IconButton label="Cerrar" onClick={onClose}><X className="size-5" /></IconButton>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">{children}</div>
        {footer && <footer className="flex flex-col-reverse gap-2 border-t border-line bg-slate-50/60 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:flex-row md:justify-end md:px-6 md:pb-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Section({ n, title, children }: { n?: number; title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line pb-5 last:border-0 last:pb-0">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        {n !== undefined && <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">{n}</span>}
        {title}
      </h3>
      {children}
    </section>
  );
}

export function Field({ label, error, hint, children, htmlFor, className }: { label: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <p className="err" role="alert">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}
