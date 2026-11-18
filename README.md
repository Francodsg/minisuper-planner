# MiniSúper Planner

Aplicación web para planificar y controlar el **surtido inicial de un minisúper en México**: catálogo propio, lista de compras con prioridades, compras parciales, presupuesto en MXN con IVA/IEPS y sincronización entre dispositivos.

- **Frontend:** React 19 + TypeScript + Vite 7 + Tailwind CSS 4, Lucide, React Hook Form + Zod, decimal.js
- **Backend:** Supabase (PostgreSQL + Auth + Realtime). PostgreSQL es la única fuente de verdad. `localStorage` solo guarda preferencias de interfaz (vista, orden, columnas).
- **Pruebas:** Vitest (lógica monetaria, impuestos, presupuesto, filtros y respaldos), pruebas SQL de integridad y Playwright (flujos principales en escritorio y móvil).

## Puesta en marcha

1. Crea un proyecto en [Supabase](https://supabase.com).
2. Aplica la migración `supabase/migrations/20261115000000_init.sql`:
   - con la CLI: `supabase link --project-ref <ref>` y luego `supabase db push`, **o**
   - pegando el archivo en *SQL Editor* y ejecutándolo.
3. En *Authentication → URL Configuration* agrega la URL de tu app (p. ej. `http://localhost:5173`) como *Site URL / Redirect URL*.
4. Configura las variables de entorno:
   ```bash
   cp .env.example .env.local   # coloca VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
   ```
5. Instala y ejecuta:
   ```bash
   npm install
   npm run dev
   ```
6. Producción: `npm run build` genera `dist/` (sitio estático; sirve en Vercel, Netlify, Cloudflare Pages, etc., con *fallback* a `index.html` para las rutas).

Al registrarse, cada usuario recibe automáticamente: su configuración, una lista “Surtido inicial” y los 9 departamentos comunes. **No se precargan categorías ni productos.**

## Importar productos en lote

*Catálogo → Importar* (o *Configuración → Importar productos desde CSV*) agrega muchos productos de una vez al catálogo y a la lista, sin borrar nada.

- Formato: CSV UTF-8 (en Excel: *Guardar como → CSV UTF-8*). Columnas obligatorias: **Producto** y **Cantidad** (entero > 0). Opcionales: Prioridad (Alta/Media/Baja, o Apertura/Después/Mucho después), Departamento, Categoría, Marca, Presentación, Costo unitario, Proveedor, Notas.
- Crea los departamentos y categorías que no existan.
- Es repetible: si se interrumpe, vuelve a importar el mismo archivo; lo ya creado se reutiliza y lo que ya está en la lista se omite.

## Publicar en GitHub Pages

El flujo `.github/workflows/deploy.yml` compila y publica la app en cada *push* a `main`, en `https://<usuario>.github.io/<repo>/`.

1. Sube el proyecto a un repositorio de GitHub (rama `main`).
2. En el repositorio: *Settings → Secrets and variables → Actions → New repository secret*, crea:
   - `VITE_SUPABASE_URL` → la URL de tu proyecto Supabase
   - `VITE_SUPABASE_ANON_KEY` → la clave pública (*anon*). Es pública por diseño; la seguridad la dan las políticas RLS.
3. *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.
4. En Supabase, *Authentication → URL Configuration*: pon `https://<usuario>.github.io/<repo>/` como *Site URL* y agrégala en *Redirect URLs*.
5. Haz un *push* (o ejecuta el flujo manualmente desde *Actions*). La base de datos sigue en Supabase; GitHub Pages solo sirve la interfaz.

Para compilar localmente con la subcarpeta: `BASE_PATH=/<repo>/ npm run build`.

## Arquitectura

```
src/
  lib/            Lógica de negocio pura (sin React ni red), 100% probada
    money.ts      Aritmética decimal y formato MXN (política de redondeo documentada)
    tax.ts        IVA / IEPS: desde precio antes de impuestos o desde precio final
    budget.ts     Filas calculadas, estados de compra, totales y presupuesto
    filters.ts    Búsqueda, filtros combinables y ordenamiento
    search.ts     Normalización sin acentos, duplicados, relevancia
    backup.ts     Respaldo JSON y CSV para Excel
  data/           Acceso a datos y autenticación
    api.ts        Todas las operaciones contra Supabase (tablas y RPC)
    DataContext   Carga los datos del usuario + Supabase Realtime (sincronización)
    AuthContext   Sesión de Supabase Auth
  components/     UI reutilizable: Layout, formularios, diálogos, toasts, menús
  pages/          Inicio, Lista, Catálogo, Departamentos, Comprados, Configuración, Login
supabase/
  migrations/     Esquema, RLS, triggers y funciones RPC
  tests/          Pruebas SQL (con un esquema auth simulado para PostgreSQL local)
e2e/              Pruebas Playwright + backend de pruebas local
```

### Modelo de datos

`departments → categories → products` (catálogo) · `shopping_lists → list_items` (planificación) · `purchases` (movimientos).

- **Producto ≠ artículo planificado.** El artículo guarda su propio costo estimado e impuestos: editar el catálogo no altera el presupuesto en silencio (en la edición se puede sincronizar explícitamente).
- **Costo desconocido (`NULL`) ≠ `$0`.** Los productos sin costo se cuentan como “presupuesto incompleto”.
- **Categoría siempre dentro de su departamento:** llave foránea compuesta `(category_id, department_id)` con `ON UPDATE CASCADE`; mover una categoría arrastra a sus productos.
- **Duplicados:** índice único sobre `nombre|marca|presentación` normalizados (activos); la UI avisa además de nombres parecidos. Un producto no puede estar dos veces activo en la misma lista.

### Compras (integridad)

- Cada compra es un **movimiento** (`purchases`), nunca un booleano. Pendientes = planificadas − Σ compras vigentes.
- Los movimientos **solo se escriben por RPC** (`register_purchase`, `correct_purchase`, `void_purchase`, `unvoid_purchase`); los usuarios no tienen permiso de `INSERT/UPDATE/DELETE` directo.
- `register_purchase` bloquea la fila del artículo (`SELECT … FOR UPDATE`), valida que no supere lo pendiente y es **idempotente** (`request_id` único por apertura del diálogo): un doble clic, un reintento o dos dispositivos simultáneos no duplican compras.
- Un trigger impide bajar la cantidad planificada por debajo de lo comprado y retirar de la lista artículos con compras.
- Las reversiones son **suaves** (`voided_at`): el historial nunca se borra y se pueden restaurar.

### Impuestos y redondeo

- Precio **antes de impuestos**: `IEPS = base × %` (o cuota fija por pieza) → `IVA = (base + IEPS) × tasa` → `final = base + IEPS + IVA`. El IEPS forma parte de la base del IVA.
- Precio **final con impuestos**: se respeta exactamente y se desglosa a la inversa; los centavos de diferencia se absorben en la base (nunca se cobran impuestos dos veces).
- IVA por producto: *tasa (%)* configurable, *tasa 0%* o *exento*. No se aplica IVA reducido automáticamente.
- Redondeo **mitad hacia arriba a centavos**, una vez por pieza; importe = costo final unitario × piezas; los totales suman importes ya redondeados.
- ⚠️ Los cálculos son estimaciones para planificar; valídalos fiscalmente si se usarán para contabilidad.

### Presupuesto

| Magnitud | Definición |
|---|---|
| Gasto realizado | Σ importes reales de los movimientos vigentes |
| Costo pendiente estimado | Σ piezas pendientes × costo final unitario estimado (solo costos conocidos) |
| Costo total proyectado | Gasto realizado + costo pendiente |
| Saldo tras el gasto | Presupuesto − gasto realizado |
| Disponible proyectado | Presupuesto − costo total proyectado |
| Exceso | max(0, proyectado − presupuesto) |

Avisos al 80% / 90% (configurables) y al superar el 100%. Nunca se bloquea agregar productos.

### Sincronización

`DataProvider` se suscribe a `postgres_changes` de las 7 tablas (filtradas por `owner_id`) y recarga los datos de forma coalescida; también recarga al recuperar el foco o la conexión. Tras cada operación local se recarga de inmediato, así que los indicadores siempre reflejan la base de datos.

## Pruebas

```bash
npm test            # Vitest: impuestos, dinero, presupuesto, filtros, búsqueda, respaldos
npm run typecheck
```

**Pruebas SQL** (PostgreSQL 15+ local; no las ejecutes en Supabase real):

```bash
createdb msp_test
psql -d msp_test -f supabase/tests/00_stub_supabase.sql
psql -d msp_test -f supabase/migrations/20261115000000_init.sql
psql -d msp_test -f supabase/tests/10_db_tests.sql   # debe imprimir "Usuario A: OK", "RLS: OK", "Respaldo: OK"
```

**E2E (Playwright)** — contra tu Supabase, o contra el backend de pruebas local, que imita la API de Supabase (Auth + REST) ejecutando el SQL real sobre una base preparada como arriba:

```bash
DATABASE_URL="postgresql://postgres@localhost/msp_test" node e2e/mock-backend.mjs   # terminal 1
npx vite --mode e2e --port 5179                                                      # terminal 2 (.env.e2e → VITE_SUPABASE_URL=http://localhost:54331)
npm run e2e -- --trace off                                                           # terminal 3
```

Cubre: alta de cuenta, presupuesto, alta de productos (con y sin costo), compra parcial 12/20, bloqueo de exceso, compra completa, avisos, sección Comprados, reversión, detección de duplicados, departamentos precargados y creación de categorías, en escritorio (1440×900) y móvil (Pixel 7).
