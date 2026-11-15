import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreVertical } from 'lucide-react';
import { cx } from './ui';

export interface MenuItem { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string }

export function Menu({ items, label = 'Acciones', trigger }: { items: MenuItem[]; label?: string; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="inline-flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-slate-100 hover:text-ink">
        {trigger ?? <MoreVertical className="size-4" />}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-1 w-56 animate-fade-in rounded-xl border border-line bg-white p-1 shadow-lg">
          {items.map((it) => (
            <button key={it.label} role="menuitem" disabled={it.disabled} title={it.hint}
              onClick={() => { setOpen(false); it.onClick(); }}
              className={cx('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40',
                it.danger ? 'text-danger hover:bg-red-50' : 'hover:bg-slate-100')}>
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
