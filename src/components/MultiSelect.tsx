import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cx } from './ui';

export function MultiSelect({ label, options, value, onChange, disabled, emptyText = 'Sin opciones' }: {
  label: string; options: Array<{ value: string; label: string; group?: string }>; value: string[];
  onChange: (v: string[]) => void; disabled?: boolean; emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const text = value.length === 0 ? label : value.length === 1 ? options.find((o) => o.value === value[0])?.label ?? label : `${label} (${value.length})`;
  let lastGroup: string | undefined;
  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={cx('chip w-full justify-between md:w-auto', value.length > 0 && 'border-primary bg-primary/10 text-primary-dark')}>
        <span className="truncate">{text}</span><ChevronDown className="size-4 shrink-0" />
      </button>
      {open && (
        <div role="listbox" aria-multiselectable className="absolute left-0 z-40 mt-1 max-h-72 w-64 animate-fade-in overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-lg">
          {options.length === 0 && <p className="px-3 py-2 text-sm text-muted">{emptyText}</p>}
          {options.map((o) => {
            const header = o.group && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <div key={o.value}>
                {header && <p className="px-3 pt-2 pb-1 text-xs font-semibold text-muted uppercase">{header}</p>}
                <button type="button" role="option" aria-selected={value.includes(o.value)} onClick={() => toggle(o.value)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100">
                  <span className={cx('flex size-4 items-center justify-center rounded border', value.includes(o.value) ? 'border-primary bg-primary text-white' : 'border-slate-300')}>
                    {value.includes(o.value) && <Check className="size-3" />}
                  </span>{o.label}
                </button>
              </div>
            );
          })}
          {value.length > 0 && <button type="button" className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm text-primary hover:bg-slate-100" onClick={() => onChange([])}>Quitar selección</button>}
        </div>
      )}
    </div>
  );
}
