import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

/** Si algo falla al renderizar, muestra el error en lugar de una página en blanco. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ maxWidth: 560, margin: '64px auto', padding: 16, fontFamily: 'Inter, system-ui, sans-serif', color: '#0F172A' }}>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>MiniSúper Planner no pudo iniciar</h1>
        <p style={{ marginTop: 8, color: '#64748B' }}>Recarga la página. Si el problema continúa, comparte este mensaje:</p>
        <pre style={{ marginTop: 12, padding: 12, background: '#F1F5F9', borderRadius: 8, whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>,
);
