import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Usa IMPORT_CSV=<ruta> para probar con un archivo real; si no, un ejemplo pequeño.
const SAMPLE = 'Departamento,Categoría,Producto,Presentación,Cantidad,Prioridad,Costo unitario\n' +
  'Abarrotes,Granos,Arroz blanco,1 kg,18,Alta,25.50\nLimpieza,Cloros,Cloro,1 L,6,Media,\nMascotas,Croquetas,Croquetas para gato,bolsa,2,Baja,\n';

test('importar productos desde CSV (repetible, sin duplicar)', async ({ page }) => {
  test.setTimeout(180_000);
  const csv = process.env.IMPORT_CSV ? readFileSync(process.env.IMPORT_CSV, 'utf8') : SAMPLE;
  const total = csv.replace(/^﻿/, '').trim().split(/\r?\n/).length - 1;
  const file = { name: 'productos.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') };

  await page.goto('/');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.getByLabel('Correo electrónico').fill(`e2e-imp-${Date.now()}@prueba.mx`);
  await page.getByLabel('Contraseña').fill('contrasena-segura');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();

  await page.goto('/catalogo');
  await page.getByRole('button', { name: 'Importar', exact: true }).filter({ visible: true }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Importar productos' });
  await dlg.locator('input[type=file]').setInputFiles(file);
  await expect(dlg.getByText(`${total} productos se agregarán a la lista`)).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${test.info().project.name}-07-importar.png` });
  await dlg.getByRole('button', { name: `Importar ${total} productos` }).click();
  await expect(page.getByText(`Importación lista: ${total} productos agregados a la lista`)).toBeVisible({ timeout: 120_000 });

  // Repetir la importación no duplica nada
  await page.getByRole('button', { name: 'Importar', exact: true }).filter({ visible: true }).first().click();
  await dlg.locator('input[type=file]').setInputFiles(file);
  await expect(dlg.getByText(`${total} ya estaban en la lista`)).toBeVisible();
  await expect(dlg.getByRole('button', { name: 'Importar', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');

  await page.goto('/');
  await expect(page.getByText('Productos registrados')).toBeVisible();
  await expect(page.locator('p', { hasText: new RegExp(`^${total}$`) }).first()).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${test.info().project.name}-08-inicio-importado.png`, fullPage: true });
  await page.goto('/lista');
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${test.info().project.name}-09-lista-importada.png` });
});
