import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import { Home, ListChecks, BookOpen, FolderTree, PackageCheck, Settings, LogOut, MoreHorizontal, ShoppingCart, WifiOff, Plus, User } from 'lucide-react';
import { useAuth } from '@/data/AuthContext';
import { useData } from '@/data/DataContext';
import { cx, Modal } from './ui';
import { ProductFormProvider, useProductForm } from './ProductForm';
import { PurchaseDialogProvider } from './PurchaseDialog';

const NAV = [
  { to: '/', label: 'Inicio', icon: Home, end: true },
  { to: '/lista', label: 'Lista de compras', icon: ListChecks },
  { to: '/catalogo', label: 'Catálogo', icon: BookOpen },
  { to: '/departamentos', label: 'Departamentos y categorías', icon: FolderTree },
  { to: '/comprados', label: 'Comprados', icon: PackageCheck },
  { to: '/configuracion', label: 'Configuración', icon: Settings },
];

const TITLES: Record<string, string> = {
  '/': 'Inicio', '/lista': 'Lista de compras', '/catalogo': 'Catálogo', '/departamentos': 'Departamentos y categorías',
  '/comprados': 'Comprados', '/configuracion': 'Configuración',
};

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-white shadow-sm"><ShoppingCart className="size-5" /></div>
      <div className="leading-tight">
        <p className="text-[15px] font-semibold">MiniSúper Planner</p>
        <p className="text-xs text-muted">Surtido inicial</p>
      </div>
    </div>
  );
}

export function Layout() {
  return (
    <ProductFormProvider>
      <PurchaseDialogProvider>
        <Shell />
      </PurchaseDialogProvider>
    </ProductFormProvider>
  );
}

function Shell() {
  const { session, signOut } = useAuth();
  const { online } = useData();
  const loc = useLocation();
  const [more, setMore] = useState(false);
  const email = session?.user.email ?? '';
  return (
    <div className="min-h-full md:flex">
      {/* Barra lateral (escritorio) */}
      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="px-5 py-5"><Logo /></div>
        <nav className="flex-1 space-y-0.5 px-3" aria-label="Principal">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                isActive ? 'bg-primary/10 text-primary-dark' : 'text-slate-600 hover:bg-slate-100 hover:text-ink')}>
              <n.icon className="size-[18px]" aria-hidden />{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <div className="flex size-8 items-center justify-center rounded-full bg-slate-100 text-slate-600"><User className="size-4" /></div>
            <p className="min-w-0 flex-1 truncate text-sm" title={email}>{email}</p>
            <button onClick={() => void signOut()} className="rounded-md p-1.5 text-muted hover:bg-slate-100 hover:text-ink" aria-label="Cerrar sesión" title="Cerrar sesión">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Encabezado móvil */}
        <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur md:hidden">
          <div className="flex h-14 items-center justify-between px-4">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-white"><ShoppingCart className="size-4" /></div>
              <div className="leading-tight">
                <p className="text-sm font-semibold">MiniSúper Planner</p>
                <p className="text-xs text-muted">{TITLES[loc.pathname] ?? ''}</p>
              </div>
            </div>
            <button onClick={() => setMore(true)} className="flex size-10 items-center justify-center rounded-full bg-slate-100 text-slate-600" aria-label="Perfil y menú">
              <User className="size-5" />
            </button>
          </div>
        </header>
        {!online && (
          <div className="flex items-center justify-center gap-2 bg-amber-50 px-4 py-2 text-sm text-amber-800" role="status">
            <WifiOff className="size-4" /> Sin conexión. Los cambios no se guardarán hasta recuperar internet.
          </div>
        )}
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-4 pb-28 md:px-8 md:pt-7 md:pb-10">
          <Outlet />
        </main>
      </div>

      {/* Navegación inferior (móvil) */}
      <MobileNav onMore={() => setMore(true)} />
      <Modal open={more} onClose={() => setMore(false)} title="Más opciones" subtitle={email} size="sm">
        <nav className="space-y-1">
          {NAV.slice(3).map((n) => (
            <NavLink key={n.to} to={n.to} onClick={() => setMore(false)}
              className="flex h-12 items-center gap-3 rounded-lg px-3 text-base hover:bg-slate-100">
              <n.icon className="size-5 text-muted" />{n.label}
            </NavLink>
          ))}
          <button onClick={() => void signOut()} className="flex h-12 w-full items-center gap-3 rounded-lg px-3 text-base text-danger hover:bg-red-50">
            <LogOut className="size-5" /> Cerrar sesión
          </button>
        </nav>
      </Modal>
    </div>
  );
}

function MobileNav({ onMore }: { onMore: () => void }) {
  const item = (to: string, label: string, icon: ReactNode, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => cx('flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
      isActive ? 'text-primary' : 'text-slate-500')}>
      {icon}{label}
    </NavLink>
  );
  const { open } = useProductForm();
  const loc = useLocation();
  const moreActive = ['/departamentos', '/comprados', '/configuracion'].includes(loc.pathname);
  return (
    <>
      {(loc.pathname === '/lista' || loc.pathname === '/catalogo') && (
        <button onClick={() => open({})} aria-label="Agregar producto"
          className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex size-14 items-center justify-center rounded-full bg-primary text-white shadow-lg md:hidden">
          <Plus className="size-6" />
        </button>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(4rem+env(safe-area-inset-bottom))] border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Navegación inferior">
        {item('/', 'Inicio', <Home className="size-5" />, true)}
        {item('/lista', 'Compras', <ListChecks className="size-5" />)}
        {item('/catalogo', 'Catálogo', <BookOpen className="size-5" />)}
        <button onClick={onMore} className={cx('flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', moreActive ? 'text-primary' : 'text-slate-500')}>
          <MoreHorizontal className="size-5" />Más
        </button>
      </nav>
    </>
  );
}

/** Encabezado de pantalla (título, descripción y acciones). */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 md:mb-6 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function useGo() { return useNavigate(); }
