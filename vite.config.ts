/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { copyFileSync } from 'node:fs';

// En GitHub Pages la app vive en https://<usuario>.github.io/<repo>/ → BASE_PATH=/<repo>/
const base = process.env.BASE_PATH || '/';

// GitHub Pages no conoce las rutas de la app (/lista, /catalogo…): al recargar una de ellas
// sirve 404.html. Copiamos index.html como 404.html para que la app cargue igual.
const spaFallback = {
  name: 'spa-404-fallback',
  closeBundle() {
    try { copyFileSync('dist/index.html', 'dist/404.html'); } catch { /* sin build */ }
  },
};

export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), spaFallback],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
