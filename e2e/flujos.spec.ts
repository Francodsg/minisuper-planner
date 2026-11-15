import { test, expect, type Page } from '@playwright/test';

const shots = process.env.E2E_SCREENSHOTS; // carpeta opcional para capturas

async function snap(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${test.info().project.name}-${name}.png`, fullPage: true });
}
const visible = (page: Page, name: string | RegExp) => page.getByRole('button', { name }).filter({ visible: true }).first();

test('flujo completo: cuenta, presupuesto, producto, compras parciales y comprados', async ({ page }) => {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@prueba.mx`;

  // Alta de cuenta
  await page.goto('/');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill('contrasena-segura');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  await expect(page.getByText('Aún no configuras un presupuesto máximo')).toBeVisible();
  await snap(page, '01-inicio-vacio');

  // Presupuesto
  await page.goto('/configuracion');
  await page.getByLabel('Presupuesto máximo (MXN)').fill('1000');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Presupuesto actualizado')).toBeVisible();

  // Catálogo vacío
  await page.goto('/catalogo');
  await expect(page.getByText('Tu catálogo está vacío')).toBeVisible();

  // Agregar producto a la lista
  await page.goto('/lista');
  await expect(page.getByText('Tu lista está vacía')).toBeVisible();
  await visible(page, 'Agregar producto').click();
  await page.getByLabel('Nombre *').fill('Aceite vegetal');
  await page.getByLabel('Marca').fill('Girasol');
  await page.getByLabel('Presentación / descripción').fill('1 L');
  await page.getByLabel('Departamento').selectOption({ label: 'Abarrotes' });
  await page.getByLabel('Cantidad planificada (piezas) *').fill('20');
  await page.getByRole('radio', { name: 'Alta' }).click();
  await page.getByLabel('Costo unitario estimado (MXN)').fill('40');
  await expect(page.getByText('$800.00')).toBeVisible(); // importe estimado 20 × 40
  await snap(page, '02-formulario');
  await page.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(page.getByText('“Aceite vegetal” agregado a la lista')).toBeVisible();

  // Producto sin costo: no se considera gratuito
  await visible(page, 'Agregar producto').click();
  await page.getByLabel('Nombre *').fill('Cloro');
  await page.getByLabel('Cantidad planificada (piezas) *').fill('6');
  await expect(page.getByText('Costo pendiente de cotizar')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(page.getByText('“Cloro” agregado a la lista')).toBeVisible();
  await snap(page, '03-lista');

  // Compra parcial: 12 de 20
  await page.getByRole('button', { name: /^(Comprar|Registrar compra)$/ }).filter({ visible: true }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Registrar compra' });
  await dlg.getByLabel('Piezas compradas *').fill('12');
  await dlg.getByLabel('Costo unitario real final (MXN) *').fill('38.50');
  await expect(dlg.getByText('$462.00')).toBeVisible();
  await dlg.getByRole('button', { name: 'Registrar compra' }).click();
  await expect(page.getByText('Compra registrada: 12 pzas')).toBeVisible();

  // No se permite exceder lo pendiente
  await page.getByRole('button', { name: /^(Comprar|Registrar compra)$/ }).filter({ visible: true }).first().click();
  await dlg.getByLabel('Piezas compradas *').fill('9');
  await dlg.getByRole('button', { name: 'Registrar compra' }).click();
  await expect(dlg.getByText(/No puede superar lo pendiente \(8 pzas\)/)).toBeVisible();

  // Completar con las 8 restantes
  await dlg.getByRole('button', { name: 'Todo' }).click();
  await dlg.getByRole('button', { name: 'Registrar compra' }).click();
  await expect(page.getByText('“Aceite vegetal” completado')).toBeVisible();
  // ya no aparece en pendientes; Cloro sí
  await expect(page.getByText('Aceite vegetal')).toHaveCount(0);
  await expect(page.getByText('Cloro').first()).toBeVisible();

  // Inicio: gasto real y advertencia de presupuesto incompleto
  await page.goto('/');
  await expect(page.getByText('Presupuesto incompleto')).toBeVisible();
  await expect(page.getByText('$782.00').filter({ visible: true }).first()).toBeVisible(); // 462 + 320
  await expect(page.getByText('20 de 26 pzas')).toBeVisible();
  await snap(page, '04-inicio');

  // Comprados
  await page.goto('/comprados');
  await expect(page.getByText('Aceite vegetal').filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText('$782.00').filter({ visible: true }).first()).toBeVisible();
  await snap(page, '05-comprados');

  // Revertir una compra devuelve el producto a pendientes
  await visible(page, /Historial/).click();
  await page.getByRole('button', { name: 'Revertir' }).first().click();
  await page.getByRole('dialog', { name: 'Revertir compra' }).getByRole('button', { name: 'Revertir' }).click();
  await expect(page.getByText('Compra revertida')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/lista');
  await expect(page.getByText('Aceite vegetal').filter({ visible: true }).first()).toBeVisible();

  // Detección de duplicados
  await visible(page, 'Agregar producto').click();
  await page.getByLabel('Nombre *').fill('aceite vegetal');
  await page.getByLabel('Marca').fill('girasol');
  await page.getByLabel('Presentación / descripción').fill('1 l');
  await expect(page.getByText('Ya existe un producto idéntico')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar producto' })).toBeDisabled();
  await page.getByLabel('Presentación / descripción').fill('500 ml');
  await expect(page.getByText('Posibles duplicados')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar producto' })).toBeEnabled();
});

test('departamentos precargados y categorías creadas por el usuario', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.getByLabel('Correo electrónico').fill(`e2e-cat-${Date.now()}@prueba.mx`);
  await page.getByLabel('Contraseña').fill('contrasena-segura');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  await page.goto('/departamentos');
  for (const d of ['Abarrotes', 'Bebidas', 'Limpieza del hogar', 'Mascotas', 'Otros'])
    await expect(page.getByRole('button', { name: new RegExp(`^${d}`) })).toBeVisible();
  await page.getByRole('button', { name: /^Limpieza del hogar/ }).click();
  await expect(page.getByText('Sin categorías. Crea la primera')).toBeVisible();
  await page.getByRole('button', { name: 'Nueva' }).click();
  await page.getByPlaceholder('Ej. Detergentes').fill('Detergentes');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Categoría creada')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Detergentes/ })).toBeVisible();
  await snap(page, '06-departamentos');
});
