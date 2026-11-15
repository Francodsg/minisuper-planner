import { useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import { supabase, friendlyError, isConfigured } from '@/data/supabase';
import { Button, Field, cx } from '@/components/ui';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!/^\S+@\S+\.\S+$/.test(email)) { setMsg({ ok: false, text: 'Escribe un correo válido.' }); return; }
    if (mode !== 'reset' && password.length < 8) { setMsg({ ok: false, text: 'La contraseña debe tener al menos 8 caracteres.' }); return; }
    setBusy(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error.message);
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        if (!data.session) setMsg({ ok: true, text: 'Cuenta creada. Revisa tu correo para confirmarla y después inicia sesión.' });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (error) throw error;
        setMsg({ ok: true, text: 'Te enviamos un correo para restablecer tu contraseña.' });
      }
    } catch (err) { setMsg({ ok: false, text: friendlyError(err) }); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-primary text-white shadow"><ShoppingCart className="size-6" /></div>
          <h1 className="text-2xl font-semibold tracking-tight">MiniSúper Planner</h1>
          <p className="mt-1 text-sm text-muted">Planifica y controla el surtido inicial de tu minisúper.</p>
        </div>
        {!isConfigured && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Falta configurar Supabase. Copia <code>.env.example</code> a <code>.env.local</code> con la URL y la clave pública de tu proyecto.
          </div>
        )}
        <form onSubmit={submit} className="card space-y-4 p-6" noValidate>
          <h2 className="font-semibold">{{ login: 'Iniciar sesión', signup: 'Crear cuenta', reset: 'Recuperar contraseña' }[mode]}</h2>
          <Field label="Correo electrónico" htmlFor="em"><input id="em" type="email" autoComplete="email" className="input h-11" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {mode !== 'reset' && (
            <Field label="Contraseña" htmlFor="pw" hint={mode === 'signup' ? 'Mínimo 8 caracteres.' : undefined}>
              <input id="pw" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className="input h-11" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          {msg && <p className={cx('rounded-lg px-3 py-2 text-sm', msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700')} role="alert">{msg.text}</p>}
          <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!isConfigured}>
            {{ login: 'Entrar', signup: 'Crear cuenta', reset: 'Enviar enlace' }[mode]}
          </Button>
          <div className="flex justify-between text-sm">
            {mode === 'login'
              ? <><button type="button" className="text-primary hover:underline" onClick={() => setMode('signup')}>Crear cuenta</button>
                  <button type="button" className="text-muted hover:underline" onClick={() => setMode('reset')}>¿Olvidaste tu contraseña?</button></>
              : <button type="button" className="text-primary hover:underline" onClick={() => setMode('login')}>Volver a iniciar sesión</button>}
          </div>
        </form>
      </div>
    </div>
  );
}
