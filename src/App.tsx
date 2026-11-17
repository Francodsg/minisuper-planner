import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from '@/data/AuthContext';
import { DataProvider, useData } from '@/data/DataContext';
import { ToastProvider } from '@/components/Toast';
import { ConfirmProvider } from '@/components/Confirm';
import { Layout } from '@/components/Layout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import ShoppingList from '@/pages/ShoppingList';

const Catalog = lazy(() => import('@/pages/Catalog'));
const Departments = lazy(() => import('@/pages/Departments'));
const Purchased = lazy(() => import('@/pages/Purchased'));
const Settings = lazy(() => import('@/pages/Settings'));

function Spinner() {
  return <div className="flex h-full min-h-[50vh] items-center justify-center text-muted"><Loader2 className="size-6 animate-spin" aria-label="Cargando" /></div>;
}

function LoadError() {
  const { error, refresh } = useData();
  if (!error) return null;
  return (
    <div className="fixed inset-x-4 top-4 z-[70] mx-auto max-w-lg rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 shadow md:top-6" role="alert">
      No se pudieron cargar los datos: {error}. <button className="font-semibold underline" onClick={() => void refresh()}>Reintentar</button>
    </div>
  );
}

function Gate() {
  const { session, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!session) return <Login />;
  return (
    <DataProvider>
      <LoadError />
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="lista" element={<ShoppingList />} />
            <Route path="catalogo" element={<Catalog />} />
            <Route path="departamentos" element={<Departments />} />
            <Route path="comprados" element={<Purchased />} />
            <Route path="configuracion" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </DataProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <AuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <Gate />
          </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
