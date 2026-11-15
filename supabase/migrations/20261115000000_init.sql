-- =====================================================================
-- MiniSúper Planner — esquema inicial
-- PostgreSQL (Supabase). Fuente de verdad de todos los datos.
-- Todas las tablas tienen owner_id y RLS: cada usuario solo ve lo suyo.
-- Las compras solo se escriben mediante funciones RPC atómicas.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
do $$ begin
  create type priority_level as enum ('alta', 'media', 'baja');
exception when duplicate_object then null; end $$;

do $$ begin
  create type price_mode as enum ('antes_impuestos', 'con_impuestos');
exception when duplicate_object then null; end $$;

do $$ begin
  create type iva_kind as enum ('exento', 'tasa_cero', 'tasa');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ieps_kind as enum ('no_aplica', 'porcentaje', 'cuota_fija');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Configuración de usuario
-- ---------------------------------------------------------------------
create table if not exists public.user_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  budget_max numeric(14,2) not null default 0 check (budget_max >= 0),
  warn_threshold_1 smallint not null default 80 check (warn_threshold_1 between 1 and 100),
  warn_threshold_2 smallint not null default 90 check (warn_threshold_2 between 1 and 100),
  default_view text not null default 'auto' check (default_view in ('auto','tabla','tarjetas')),
  compact_rows boolean not null default false,
  backup_reminder_days smallint not null default 7 check (backup_reminder_days between 0 and 365),
  last_backup_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Departamentos → Categorías
-- ---------------------------------------------------------------------
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists departments_owner_name_uq on public.departments (owner_id, lower(btrim(name)));

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete restrict on update cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- permite FK compuesta desde productos (categoría siempre dentro de su departamento)
  unique (id, department_id)
);
create unique index if not exists categories_owner_dept_name_uq on public.categories (owner_id, department_id, lower(btrim(name)));

-- ---------------------------------------------------------------------
-- Catálogo de productos
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  brand text,
  presentation text,            -- descripción / presentación comercial (p. ej. "1 L")
  department_id uuid references public.departments(id) on delete restrict,
  category_id uuid,
  supplier text,
  -- costo unitario estimado (NULL = desconocido, distinto de 0)
  unit_cost numeric(14,2) check (unit_cost is null or unit_cost >= 0),
  price_mode price_mode not null default 'con_impuestos',
  iva_kind iva_kind not null default 'tasa',
  iva_rate numeric(7,4) not null default 16 check (iva_rate >= 0 and iva_rate <= 100),
  ieps_kind ieps_kind not null default 'no_aplica',
  ieps_value numeric(14,4) not null default 0 check (ieps_value >= 0),
  notes text,
  dedupe_key text not null,     -- nombre|marca|presentación normalizados (sin acentos, minúsculas)
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- la categoría debe pertenecer al departamento; si la categoría se mueve, el producto la sigue
  foreign key (category_id, department_id) references public.categories(id, department_id)
    on update cascade on delete restrict,
  check (category_id is null or department_id is not null)
);
create unique index if not exists products_owner_dedupe_uq on public.products (owner_id, dedupe_key) where not archived;
create index if not exists products_owner_idx on public.products (owner_id);

-- ---------------------------------------------------------------------
-- Listas de compras y artículos planificados
-- ---------------------------------------------------------------------
create table if not exists public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default 'Surtido inicial',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.list_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  list_id uuid not null references public.shopping_lists(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  planned_qty integer not null check (planned_qty > 0),
  priority priority_level not null default 'media',
  -- copia propia del costo estimado (no cambia si se edita el catálogo)
  unit_cost numeric(14,2) check (unit_cost is null or unit_cost >= 0),
  price_mode price_mode not null default 'con_impuestos',
  iva_kind iva_kind not null default 'tasa',
  iva_rate numeric(7,4) not null default 16 check (iva_rate >= 0 and iva_rate <= 100),
  ieps_kind ieps_kind not null default 'no_aplica',
  ieps_value numeric(14,4) not null default 0 check (ieps_value >= 0),
  notes text,
  removed_at timestamptz,       -- retiro suave para poder deshacer
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists list_items_active_uq on public.list_items (list_id, product_id) where removed_at is null;
create index if not exists list_items_owner_idx on public.list_items (owner_id);

-- ---------------------------------------------------------------------
-- Movimientos de compra
-- ---------------------------------------------------------------------
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  list_item_id uuid not null references public.list_items(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_cost_final numeric(14,2) not null check (unit_cost_final >= 0), -- costo real final por pieza (con impuestos)
  total numeric(14,2) generated always as (round(quantity * unit_cost_final, 2)) stored,
  purchased_at timestamptz not null default now(),
  supplier text,
  notes text,
  request_id uuid not null,     -- clave de idempotencia (evita doble registro en reintentos)
  voided_at timestamptz,        -- reversión controlada: el historial no se borra
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, request_id)
);
create index if not exists purchases_item_idx on public.purchases (list_item_id);

-- ---------------------------------------------------------------------
-- Triggers updated_at
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['user_settings','departments','categories','products','shopping_lists','list_items','purchases'] loop
    execute format('drop trigger if exists trg_touch on public.%I', t);
    execute format('create trigger trg_touch before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Integridad: la cantidad planificada nunca puede ser menor a lo comprado
-- ---------------------------------------------------------------------
create or replace function public.purchased_qty(p_item uuid)
returns integer language sql stable as $$
  select coalesce(sum(quantity), 0)::integer from public.purchases
  where list_item_id = p_item and voided_at is null
$$;

create or replace function public.check_planned_qty()
returns trigger language plpgsql as $$
declare v_bought integer;
begin
  if new.planned_qty is distinct from old.planned_qty then
    v_bought := public.purchased_qty(new.id);
    if new.planned_qty < v_bought then
      raise exception 'La cantidad planificada (%) no puede ser menor a la ya comprada (%)', new.planned_qty, v_bought
        using errcode = 'P0001';
    end if;
  end if;
  if new.removed_at is not null and old.removed_at is null and public.purchased_qty(new.id) > 0 then
    raise exception 'No se puede retirar un artículo con compras registradas. Revierte primero sus compras.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_check_planned on public.list_items;
create trigger trg_check_planned before update on public.list_items
  for each row execute function public.check_planned_qty();

-- ---------------------------------------------------------------------
-- Alta de usuario: configuración, lista inicial y departamentos comunes
-- (las categorías NO se precargan; el catálogo comienza vacío)
-- ---------------------------------------------------------------------
create or replace function public.bootstrap_user(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d text; i int := 0;
begin
  insert into public.user_settings(owner_id) values (p_uid) on conflict do nothing;
  if not exists (select 1 from public.shopping_lists where owner_id = p_uid) then
    insert into public.shopping_lists(owner_id, name) values (p_uid, 'Surtido inicial');
  end if;
  if not exists (select 1 from public.departments where owner_id = p_uid) then
    foreach d in array array['Abarrotes','Bebidas','Botanas y dulces','Limpieza del hogar','Higiene personal',
                             'Papelería','Artículos para el hogar','Mascotas','Otros'] loop
      i := i + 1;
      insert into public.departments(owner_id, name, sort_order) values (p_uid, d, i);
    end loop;
  end if;
end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.bootstrap_user(new.id);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Para usuarios ya existentes o recuperación: el cliente puede invocarla
create or replace function public.ensure_bootstrap()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  perform public.bootstrap_user(auth.uid());
end $$;

-- ---------------------------------------------------------------------
-- RPC de compras (atómicas, con bloqueo de fila e idempotencia)
-- ---------------------------------------------------------------------
create or replace function public.register_purchase(
  p_list_item_id uuid,
  p_quantity integer,
  p_unit_cost_final numeric,
  p_purchased_at timestamptz,
  p_supplier text,
  p_notes text,
  p_request_id uuid
) returns public.purchases
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_item public.list_items;
  v_existing public.purchases;
  v_bought integer;
  v_row public.purchases;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'La cantidad debe ser un entero positivo'; end if;
  if p_unit_cost_final is null or p_unit_cost_final < 0 then raise exception 'El costo unitario real es obligatorio y no puede ser negativo'; end if;
  if p_request_id is null then raise exception 'Falta la clave de la operación'; end if;

  -- Bloquea el artículo: serializa compras simultáneas desde varios dispositivos
  select * into v_item from public.list_items
   where id = p_list_item_id and owner_id = v_uid for update;
  if not found then raise exception 'Artículo no encontrado'; end if;
  if v_item.removed_at is not null then raise exception 'El artículo fue retirado de la lista'; end if;

  -- Idempotencia: si ya se registró esta operación, se devuelve la existente
  select * into v_existing from public.purchases where owner_id = v_uid and request_id = p_request_id;
  if found then return v_existing; end if;

  v_bought := public.purchased_qty(v_item.id);
  if p_quantity > v_item.planned_qty - v_bought then
    raise exception 'La compra (% pzas) supera lo pendiente (% pzas). Modifica primero la cantidad planificada.',
      p_quantity, v_item.planned_qty - v_bought using errcode = 'P0001';
  end if;

  insert into public.purchases(owner_id, list_item_id, quantity, unit_cost_final, purchased_at, supplier, notes, request_id)
  values (v_uid, v_item.id, p_quantity, round(p_unit_cost_final, 2), coalesce(p_purchased_at, now()),
          nullif(btrim(p_supplier), ''), nullif(btrim(p_notes), ''), p_request_id)
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.correct_purchase(
  p_purchase_id uuid,
  p_quantity integer,
  p_unit_cost_final numeric,
  p_purchased_at timestamptz,
  p_supplier text,
  p_notes text
) returns public.purchases
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_p public.purchases;
  v_item public.list_items;
  v_other integer;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'La cantidad debe ser un entero positivo'; end if;
  if p_unit_cost_final is null or p_unit_cost_final < 0 then raise exception 'Costo inválido'; end if;

  select * into v_p from public.purchases where id = p_purchase_id and owner_id = v_uid;
  if not found then raise exception 'Movimiento no encontrado'; end if;
  if v_p.voided_at is not null then raise exception 'El movimiento está revertido'; end if;

  select * into v_item from public.list_items where id = v_p.list_item_id for update;
  select coalesce(sum(quantity),0) into v_other from public.purchases
   where list_item_id = v_item.id and voided_at is null and id <> v_p.id;
  if v_other + p_quantity > v_item.planned_qty then
    raise exception 'La corrección dejaría % pzas compradas de % planificadas', v_other + p_quantity, v_item.planned_qty;
  end if;

  update public.purchases set quantity = p_quantity, unit_cost_final = round(p_unit_cost_final, 2),
    purchased_at = coalesce(p_purchased_at, purchased_at),
    supplier = nullif(btrim(p_supplier), ''), notes = nullif(btrim(p_notes), '')
  where id = v_p.id returning * into v_p;
  return v_p;
end $$;

create or replace function public.void_purchase(p_purchase_id uuid, p_reason text)
returns public.purchases
language plpgsql security definer set search_path = public as $$
declare v_p public.purchases;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  update public.purchases set voided_at = now(), void_reason = nullif(btrim(p_reason), '')
   where id = p_purchase_id and owner_id = auth.uid() and voided_at is null
  returning * into v_p;
  if not found then raise exception 'Movimiento no encontrado o ya revertido'; end if;
  return v_p;
end $$;

create or replace function public.unvoid_purchase(p_purchase_id uuid)
returns public.purchases
language plpgsql security definer set search_path = public as $$
declare v_p public.purchases; v_item public.list_items; v_bought integer;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  select * into v_p from public.purchases where id = p_purchase_id and owner_id = auth.uid();
  if not found or v_p.voided_at is null then raise exception 'Movimiento no encontrado o no revertido'; end if;
  select * into v_item from public.list_items where id = v_p.list_item_id for update;
  v_bought := public.purchased_qty(v_item.id);
  if v_bought + v_p.quantity > v_item.planned_qty then
    raise exception 'No se puede restaurar: superaría la cantidad planificada';
  end if;
  update public.purchases set voided_at = null, void_reason = null where id = v_p.id returning * into v_p;
  return v_p;
end $$;

-- ---------------------------------------------------------------------
-- Eliminar categoría resolviendo explícitamente sus productos
--   p_mode = 'reasignar' (requiere p_target) | 'sin_categoria'
-- ---------------------------------------------------------------------
create or replace function public.delete_category(p_category_id uuid, p_mode text, p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_cat public.categories; v_target public.categories; v_count int;
begin
  select * into v_cat from public.categories where id = p_category_id and owner_id = auth.uid() for update;
  if not found then raise exception 'Categoría no encontrada'; end if;
  select count(*) into v_count from public.products where category_id = v_cat.id;
  if v_count > 0 then
    if p_mode = 'reasignar' then
      select * into v_target from public.categories where id = p_target and owner_id = auth.uid();
      if not found or v_target.id = v_cat.id then raise exception 'Categoría destino inválida'; end if;
      update public.products set category_id = v_target.id, department_id = v_target.department_id
       where category_id = v_cat.id;
    elsif p_mode = 'sin_categoria' then
      update public.products set category_id = null where category_id = v_cat.id;
    else
      raise exception 'La categoría tiene % productos: indica qué hacer con ellos', v_count;
    end if;
  end if;
  delete from public.categories where id = v_cat.id;
end $$;

-- ---------------------------------------------------------------------
-- Restaurar respaldo completo (reemplaza todos los datos del usuario)
-- ---------------------------------------------------------------------
create or replace function public.restore_backup(p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if coalesce(p_data->>'app','') <> 'minisuper-planner' then raise exception 'El archivo no es un respaldo de MiniSúper Planner'; end if;

  delete from public.purchases where owner_id = v_uid;
  delete from public.list_items where owner_id = v_uid;
  delete from public.shopping_lists where owner_id = v_uid;
  delete from public.products where owner_id = v_uid;
  delete from public.categories where owner_id = v_uid;
  delete from public.departments where owner_id = v_uid;

  insert into public.departments(id, owner_id, name, sort_order, created_at)
  select r.id, v_uid, r.name, coalesce(r.sort_order,0), coalesce(r.created_at, now())
  from jsonb_populate_recordset(null::public.departments, coalesce(p_data->'departments','[]')) r;

  insert into public.categories(id, owner_id, department_id, name, sort_order, created_at)
  select r.id, v_uid, r.department_id, r.name, coalesce(r.sort_order,0), coalesce(r.created_at, now())
  from jsonb_populate_recordset(null::public.categories, coalesce(p_data->'categories','[]')) r;

  insert into public.products(id, owner_id, name, brand, presentation, department_id, category_id, supplier, unit_cost,
    price_mode, iva_kind, iva_rate, ieps_kind, ieps_value, notes, dedupe_key, archived, created_at)
  select r.id, v_uid, r.name, r.brand, r.presentation, r.department_id, r.category_id, r.supplier, r.unit_cost,
    r.price_mode, r.iva_kind, r.iva_rate, r.ieps_kind, r.ieps_value, r.notes, r.dedupe_key, r.archived, coalesce(r.created_at, now())
  from jsonb_populate_recordset(null::public.products, coalesce(p_data->'products','[]')) r;

  insert into public.shopping_lists(id, owner_id, name, created_at)
  select r.id, v_uid, r.name, coalesce(r.created_at, now())
  from jsonb_populate_recordset(null::public.shopping_lists, coalesce(p_data->'shopping_lists','[]')) r;

  insert into public.list_items(id, owner_id, list_id, product_id, planned_qty, priority, unit_cost, price_mode,
    iva_kind, iva_rate, ieps_kind, ieps_value, notes, removed_at, added_at)
  select r.id, v_uid, r.list_id, r.product_id, r.planned_qty, r.priority, r.unit_cost, r.price_mode,
    r.iva_kind, r.iva_rate, r.ieps_kind, r.ieps_value, r.notes, r.removed_at, coalesce(r.added_at, now())
  from jsonb_populate_recordset(null::public.list_items, coalesce(p_data->'list_items','[]')) r;

  insert into public.purchases(id, owner_id, list_item_id, quantity, unit_cost_final, purchased_at, supplier, notes,
    request_id, voided_at, void_reason, created_at)
  select r.id, v_uid, r.list_item_id, r.quantity, r.unit_cost_final, r.purchased_at, r.supplier, r.notes,
    coalesce(r.request_id, gen_random_uuid()), r.voided_at, r.void_reason, coalesce(r.created_at, now())
  from jsonb_populate_recordset(null::public.purchases, coalesce(p_data->'purchases','[]')) r;

  if p_data ? 'settings' then
    insert into public.user_settings(owner_id) values (v_uid) on conflict do nothing;
    update public.user_settings s set
      budget_max = coalesce((p_data->'settings'->>'budget_max')::numeric, s.budget_max),
      warn_threshold_1 = coalesce((p_data->'settings'->>'warn_threshold_1')::smallint, s.warn_threshold_1),
      warn_threshold_2 = coalesce((p_data->'settings'->>'warn_threshold_2')::smallint, s.warn_threshold_2),
      backup_reminder_days = coalesce((p_data->'settings'->>'backup_reminder_days')::smallint, s.backup_reminder_days)
    where owner_id = v_uid;
  end if;

  -- integridad posterior: ninguna compra puede exceder lo planificado
  if exists (
    select 1 from public.list_items li
    where li.owner_id = v_uid and public.purchased_qty(li.id) > li.planned_qty
  ) then
    raise exception 'El respaldo es inconsistente: hay compras que superan lo planificado';
  end if;

  perform public.bootstrap_user(v_uid);
end $$;

-- ---------------------------------------------------------------------
-- Seguridad: RLS
-- ---------------------------------------------------------------------
alter table public.user_settings  enable row level security;
alter table public.departments    enable row level security;
alter table public.categories     enable row level security;
alter table public.products       enable row level security;
alter table public.shopping_lists enable row level security;
alter table public.list_items     enable row level security;
alter table public.purchases      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['user_settings','departments','categories','products','shopping_lists','list_items'] loop
    execute format('drop policy if exists own_all on public.%I', t);
    execute format('create policy own_all on public.%I for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;

-- compras: solo lectura directa; escritura únicamente vía RPC
drop policy if exists own_select on public.purchases;
create policy own_select on public.purchases for select to authenticated using (owner_id = auth.uid());
revoke insert, update, delete on public.purchases from anon, authenticated;

-- las FK cruzadas también deben pertenecer al mismo dueño
create or replace function public.check_same_owner()
returns trigger language plpgsql as $$
begin
  if tg_table_name = 'categories' then
    if not exists (select 1 from public.departments where id = new.department_id and owner_id = new.owner_id) then
      raise exception 'Departamento inválido'; end if;
  elsif tg_table_name = 'products' then
    if new.department_id is not null and not exists (select 1 from public.departments where id = new.department_id and owner_id = new.owner_id) then
      raise exception 'Departamento inválido'; end if;
  elsif tg_table_name = 'list_items' then
    if not exists (select 1 from public.shopping_lists where id = new.list_id and owner_id = new.owner_id)
       or not exists (select 1 from public.products where id = new.product_id and owner_id = new.owner_id) then
      raise exception 'Lista o producto inválido'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_same_owner on public.categories;
create trigger trg_same_owner before insert or update on public.categories for each row execute function public.check_same_owner();
drop trigger if exists trg_same_owner on public.products;
create trigger trg_same_owner before insert or update on public.products for each row execute function public.check_same_owner();
drop trigger if exists trg_same_owner on public.list_items;
create trigger trg_same_owner before insert or update on public.list_items for each row execute function public.check_same_owner();

revoke execute on function public.bootstrap_user(uuid) from public, anon, authenticated;
grant execute on function public.ensure_bootstrap() to authenticated;
grant execute on function public.register_purchase(uuid, integer, numeric, timestamptz, text, text, uuid) to authenticated;
grant execute on function public.correct_purchase(uuid, integer, numeric, timestamptz, text, text) to authenticated;
grant execute on function public.void_purchase(uuid, text) to authenticated;
grant execute on function public.unvoid_purchase(uuid) to authenticated;
grant execute on function public.delete_category(uuid, text, uuid) to authenticated;
grant execute on function public.restore_backup(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Realtime (sincronización entre dispositivos)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['user_settings','departments','categories','products','shopping_lists','list_items','purchases'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; when undefined_object then null;
    end;
  end loop;
end $$;
