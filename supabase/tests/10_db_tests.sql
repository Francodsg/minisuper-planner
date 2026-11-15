-- Pruebas de integridad de la base de datos (ejecutar tras la migración con el stub).
\set ON_ERROR_STOP on
insert into auth.users values ('11111111-1111-1111-1111-111111111111','a@x.mx'), ('22222222-2222-2222-2222-222222222222','b@x.mx');

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);

do $$
declare dep uuid; cat uuid; prod uuid; lst uuid; itm uuid; pu public.purchases; pu2 public.purchases; n int; rid uuid := gen_random_uuid();
begin
  -- alta: 9 departamentos, 0 categorías, 0 productos, 1 lista
  assert (select count(*) from departments) = 9, 'departamentos precargados';
  assert (select count(*) from categories) = 0, 'sin categorías precargadas';
  assert (select count(*) from products) = 0, 'catálogo vacío';
  select id into lst from shopping_lists;
  select id into dep from departments where name = 'Limpieza del hogar';

  insert into categories(department_id, name) values (dep, 'Detergentes') returning id into cat;
  insert into products(name, brand, presentation, department_id, category_id, unit_cost, dedupe_key)
    values ('Detergente', 'Marca', '1 kg', dep, cat, 45.50, 'detergente|marca|1 kg') returning id into prod;

  -- duplicado exacto bloqueado; otra presentación permitida
  begin
    insert into products(name, dedupe_key) values ('Detergente', 'detergente|marca|1 kg');
    raise exception 'debió fallar duplicado';
  exception when unique_violation then null; end;
  insert into products(name, dedupe_key) values ('Detergente', 'detergente|marca|500 g');

  insert into list_items(list_id, product_id, planned_qty, priority, unit_cost) values (lst, prod, 20, 'alta', 45.50) returning id into itm;
  -- no se puede agregar dos veces
  begin
    insert into list_items(list_id, product_id, planned_qty) values (lst, prod, 1);
    raise exception 'debió fallar doble alta';
  exception when unique_violation then null; end;
  -- cantidad decimal/negativa rechazada
  begin update list_items set planned_qty = 0 where id = itm; raise exception 'x'; exception when check_violation then null; end;

  -- compra parcial 12 de 20
  pu := register_purchase(itm, 12, 44.90, now(), 'Central', null, rid);
  assert purchased_qty(itm) = 12, 'compradas 12';
  assert pu.total = 538.80, 'total exacto';
  -- reintento con la misma clave: idempotente
  pu2 := register_purchase(itm, 12, 44.90, now(), 'Central', null, rid);
  assert pu2.id = pu.id and purchased_qty(itm) = 12, 'idempotencia';
  -- exceder lo pendiente
  begin perform register_purchase(itm, 9, 44.90, now(), null, null, gen_random_uuid()); raise exception 'debió fallar exceso';
  exception when raise_exception then if sqlerrm not like '%supera lo pendiente%' then raise; end if; end;
  -- la planificación no puede quedar debajo de lo comprado
  begin update list_items set planned_qty = 10 where id = itm; raise exception 'debió fallar planned<comprado';
  exception when raise_exception then if sqlerrm not like '%no puede ser menor%' then raise; end if; end;
  -- no se puede retirar con compras
  begin update list_items set removed_at = now() where id = itm; raise exception 'debió fallar retiro';
  exception when raise_exception then if sqlerrm not like '%compras registradas%' then raise; end if; end;
  -- inserción directa en purchases prohibida
  begin
    insert into purchases(owner_id, list_item_id, quantity, unit_cost_final, request_id) values (auth.uid(), itm, 1, 1, gen_random_uuid());
    raise exception 'debió fallar insert directo';
  exception when insufficient_privilege then null; end;

  -- completar
  perform register_purchase(itm, 8, 45.00, now(), null, null, gen_random_uuid());
  assert purchased_qty(itm) = 20, 'completado';
  -- corregir y revertir
  pu := correct_purchase(pu.id, 10, 44.00, null, 'Central', 'corregido');
  assert purchased_qty(itm) = 18, 'corrección';
  perform void_purchase(pu.id, 'error');
  assert purchased_qty(itm) = 8, 'reversión';
  assert (select count(*) from purchases where list_item_id = itm) = 2, 'historial conservado';
  perform unvoid_purchase(pu.id);
  assert purchased_qty(itm) = 18, 'restaurado';

  -- mover categoría arrastra el departamento de sus productos
  update categories set department_id = (select id from departments where name = 'Otros') where id = cat;
  assert (select department_id from products where id = prod) = (select id from departments where name = 'Otros'), 'cascada de departamento';
  -- categoría con productos no se borra sin resolución
  begin perform delete_category(cat, null, null); raise exception 'debió fallar';
  exception when raise_exception then if sqlerrm not like '%indica qué hacer%' then raise; end if; end;
  perform delete_category(cat, 'sin_categoria', null);
  assert (select category_id from products where id = prod) is null, 'sin categoría';
  raise notice 'Usuario A: OK';
end $$;

-- Aislamiento entre usuarios (RLS)
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', false);
do $$
begin
  perform ensure_bootstrap();
  assert (select count(*) from products) = 0, 'B no ve productos de A';
  assert (select count(*) from purchases) = 0, 'B no ve compras de A';
  assert (select count(*) from departments) = 9, 'B tiene sus departamentos';
  begin
    perform register_purchase((select id from public.list_items limit 1), 1, 1, now(), null, null, gen_random_uuid());
  exception when others then null; end;
  raise notice 'RLS: OK';
end $$;

-- Respaldo/restauración (como A)
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);
do $$
declare b jsonb;
begin
  select jsonb_build_object('app','minisuper-planner','version',1,
    'settings', jsonb_build_object('budget_max', 5000),
    'departments', (select jsonb_agg(to_jsonb(d)) from departments d),
    'categories', coalesce((select jsonb_agg(to_jsonb(c)) from categories c), '[]'),
    'products', (select jsonb_agg(to_jsonb(p)) from products p),
    'shopping_lists', (select jsonb_agg(to_jsonb(l)) from shopping_lists l),
    'list_items', (select jsonb_agg(to_jsonb(i)) from list_items i),
    'purchases', (select jsonb_agg(to_jsonb(p) - 'total') from purchases p)) into b;
  perform restore_backup(b);
  assert (select count(*) from purchases) = 2 and (select sum(quantity) from purchases where voided_at is null) = 18, 'restaurado';
  assert (select budget_max from user_settings) = 5000, 'presupuesto restaurado';
  raise notice 'Respaldo: OK';
end $$;
reset role;
