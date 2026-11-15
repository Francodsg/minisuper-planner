import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas E2E de los flujos principales.
 * Requieren la app corriendo contra un backend (Supabase real o el backend de pruebas
 * local `e2e/mock-backend.mjs`). Ver README → "Pruebas".
 */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5179',
    trace: 'off',
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [
    { name: 'escritorio', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'movil', use: { ...devices['Pixel 7'], launchOptions: executablePath ? { executablePath } : undefined } },
  ],
});
