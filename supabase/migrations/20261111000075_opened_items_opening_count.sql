-- KHO LIỆU TRÌNH: CHAI ĐANG MỞ + KIỂM KHO ĐẦU KỲ
-- * Tồn kho vẫn đếm theo chai / lọ / hũ… còn nguyên (số nguyên).
-- * "Chai đang mở" (opened_items): chai đã xuất khỏi kho liệu trình, đang dùng ở chi nhánh, kèm mức còn lại (%).
--   - Kiểm kho đầu kỳ: chai đang dở ghi mức còn ước lượng (Gần hết / 1/4 / 1/3 / 1/2 / 2/3 / 3/4).
--   - Duyệt phiếu xin xuất: mỗi chai / lọ / hũ / tuýp / hộp / set / bộ xuất ra thành 1 chai đang mở (100%).
--     Hàng dùng 1 lần (cái, miếng, gói, ống, túi) xuất ra là dùng hết, không thành chai đang mở.
--   - KTV / kho bấm "Hết chai" khi dùng hết.
-- * Phiếu kiểm đầu kỳ luôn chờ chủ spa duyệt (chủ tự làm thì áp dụng ngay).

-- ============ 1) CHAI ĐANG MỞ ============
create table public.opened_items (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id),
  product_id uuid not null references public.products(id),
  remaining_pct numeric(5,2) not null default 100 check (remaining_pct > 0 and remaining_pct <= 100), -- mức còn lúc mở / lúc kiểm đầu kỳ
  source text not null check (source in ('opening','request')),
  request_id uuid references public.stock_requests(id),
  count_id uuid references public.stock_counts(id),
  unit_cost numeric(12,0),                       -- giá vốn phần còn lại của chai (chỉ chủ / quản lý / kho)
  status text not null default 'open' check (status in ('open','finished')),
  opened_by uuid references public.profiles(id) default auth.uid(),
  opened_at timestamptz not null default now(),
  finished_by uuid references public.profiles(id),
  finished_at timestamptz,
  finish_note text
);
create index on public.opened_items (warehouse_id, status);
create index on public.opened_items (product_id);
create index on public.opened_items (request_id);
create index on public.opened_items (count_id);
alter table public.opened_items enable row level security;
create policy "staff read" on public.opened_items for select to authenticated using ((select public.is_staff()));
revoke select on public.opened_items from anon, authenticated;
grant select (id, warehouse_id, product_id, remaining_pct, source, request_id, count_id, status,
              opened_by, opened_at, finished_by, finished_at, finish_note)
  on public.opened_items to authenticated;

-- hàng dùng 1 lần: xuất ra là hết, không theo dõi chai đang mở
create or replace function public.is_single_use_unit(p_unit text)
returns boolean language sql immutable set search_path = '' as $$
  select lower(coalesce(p_unit, '')) in ('cái','miếng','gói','ống','túi')
$$;

-- KTV / kho / quản lý / chủ báo hết chai
create or replace function public.finish_opened_item(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v record; v_me record;
begin
  select o.*, w.branch_id into v from public.opened_items o join public.warehouses w on w.id = o.warehouse_id
   where o.id = p_id for update of o;
  if not found then raise exception 'Không tìm thấy chai'; end if;
  if v.status <> 'open' then raise exception 'Chai này đã báo hết rồi'; end if;
  select role, branch_id into v_me from public.profiles where id = (select auth.uid()) and is_active;
  if not (public.can_manage_warehouse(v.warehouse_id)
          or (public.has_role('technician','receptionist') and v_me.branch_id = v.branch_id)) then
    raise exception 'Bạn không có quyền báo hết chai của chi nhánh này';
  end if;
  update public.opened_items
     set status = 'finished', finished_by = (select auth.uid()), finished_at = now(), finish_note = nullif(trim(p_note), '')
   where id = p_id;
end $$;
revoke execute on function public.finish_opened_item(uuid, text) from public, anon;
grant execute on function public.finish_opened_item(uuid, text) to authenticated;

-- ============ 2) DUYỆT XIN XUẤT → TẠO CHAI ĐANG MỞ ============
create or replace function public.stock_requests_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = new.status then return new; end if;
  if old.status <> 'pending' then raise exception 'Phiếu đã được xử lý'; end if;
  if new.status in ('approved','rejected') then
    if not public.has_role('owner','manager','warehouse') then
      raise exception 'Chỉ quản lý kho được duyệt phiếu';
    end if;
    new.reviewed_by := (select auth.uid());
    new.reviewed_at := now();
  end if;
  if new.status = 'approved' then
    insert into public.stock_movements (warehouse_id, product_id, movement_type, quantity, request_id, note)
    select new.warehouse_id, sri.product_id, 'export_use', -sri.quantity, new.id, 'Xuất theo yêu cầu KTV'
      from public.stock_request_items sri where sri.request_id = new.id;
    -- mỗi chai / lọ / hũ… xuất ra = 1 chai đang mở, đầy 100%
    insert into public.opened_items (warehouse_id, product_id, remaining_pct, source, request_id, unit_cost, opened_by)
    select m.warehouse_id, m.product_id, 100, 'request', new.id, m.unit_cost, new.requested_by
      from public.stock_movements m
      join public.products p on p.id = m.product_id
      cross join lateral generate_series(1, -m.quantity)
     where m.request_id = new.id and m.quantity < 0 and not public.is_single_use_unit(p.unit);
  end if;
  return new;
end $$;

-- ============ 3) KIỂM KHO ĐẦU KỲ ============
alter table public.stock_counts add column kind text not null default 'regular' check (kind in ('regular','opening'));
grant select (kind) on public.stock_counts to authenticated;

create table public.stock_count_opened (  -- chai đang dở ghi trong phiếu kiểm đầu kỳ
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.stock_counts(id) on delete cascade,
  product_id uuid not null references public.products(id),
  remaining_pct numeric(5,2) not null check (remaining_pct > 0 and remaining_pct <= 100)
);
create index on public.stock_count_opened (count_id);
create index on public.stock_count_opened (product_id);
alter table public.stock_count_opened enable row level security;
create policy "staff read" on public.stock_count_opened for select to authenticated using ((select public.is_staff()));

create or replace function public._apply_stock_count(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c record; v_i record;
begin
  select * into v_c from public.stock_counts where id = p_id;
  for v_i in select i.*, p.cost_price from public.stock_count_items i join public.products p on p.id = i.product_id
              where i.count_id = p_id and i.counted_qty <> i.system_qty loop
    insert into public.stock_movements (warehouse_id, product_id, movement_type, quantity, unit_cost, note)
    values (v_c.warehouse_id, v_i.product_id, 'adjustment', v_i.counted_qty - v_i.system_qty,
            -- đầu kỳ: hàng tăng thêm lấy giá vốn hiện tại của sản phẩm làm giá lô
            case when v_c.kind = 'opening' and v_i.counted_qty > v_i.system_qty then v_i.cost_price end,
            case when v_c.kind = 'opening' then 'Kiểm đầu kỳ ' else 'Kiểm kho ' end || v_c.code || coalesce(': ' || v_c.note, ''));
  end loop;

  if v_c.kind = 'opening' then
    -- chai đang mở cũ của các sản phẩm đã kiểm: thay bằng số liệu đầu kỳ
    update public.opened_items o
       set status = 'finished', finished_by = (select auth.uid()), finished_at = now(),
           finish_note = 'Thay bằng kiểm đầu kỳ ' || v_c.code
     where o.warehouse_id = v_c.warehouse_id and o.status = 'open'
       and o.product_id in (select product_id from public.stock_count_items where count_id = p_id
                            union select product_id from public.stock_count_opened where count_id = p_id);
    insert into public.opened_items (warehouse_id, product_id, remaining_pct, source, count_id, unit_cost, opened_by, opened_at)
    select v_c.warehouse_id, s.product_id, s.remaining_pct, 'opening', p_id,
           round(coalesce(p.cost_price, 0) * s.remaining_pct / 100), v_c.created_by, v_c.created_at
      from public.stock_count_opened s join public.products p on p.id = s.product_id
     where s.count_id = p_id;
  end if;

  update public.stock_counts set status = 'applied', reviewed_by = coalesce(reviewed_by, (select auth.uid())),
         reviewed_at = coalesce(reviewed_at, now()) where id = p_id;
end $$;
revoke execute on function public._apply_stock_count(uuid) from public, anon, authenticated;

-- p_items: [{product_id, counted: số chai nguyên, opened: [50, 33.33, …] = mức còn (%) của từng chai đang dở}]
create or replace function public.submit_opening_count(p_warehouse_id uuid, p_items jsonb, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid; v_it jsonb; v_pct jsonb; v_qty int; v_cnt int; v_prod uuid; v_type public.warehouse_type; v_p numeric;
begin
  if not public.can_manage_warehouse(p_warehouse_id) then raise exception 'Bạn không có quyền kiểm kho này'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Chưa nhập số đếm sản phẩm nào';
  end if;
  select type into v_type from public.warehouses where id = p_warehouse_id;
  insert into public.stock_counts (warehouse_id, note, kind)
  values (p_warehouse_id, nullif(trim(p_note), ''), 'opening') returning id into v_id;

  for v_it in select value from jsonb_array_elements(p_items) loop
    v_prod := (v_it->>'product_id')::uuid;
    v_cnt := (v_it->>'counted')::int;
    if v_cnt is null or v_cnt < 0 or v_cnt > 100000 then raise exception 'Số chai nguyên không hợp lệ'; end if;
    if not exists (select 1 from public.products where id = v_prod) then raise exception 'Sản phẩm không tồn tại'; end if;
    select coalesce(sum(quantity), 0) into v_qty from public.stock_movements
     where warehouse_id = p_warehouse_id and product_id = v_prod;
    insert into public.stock_count_items (count_id, product_id, system_qty, counted_qty)
    values (v_id, v_prod, v_qty, v_cnt)
    on conflict (count_id, product_id) do update set counted_qty = excluded.counted_qty;

    if jsonb_typeof(v_it->'opened') = 'array' and jsonb_array_length(v_it->'opened') > 0 then
      if v_type <> 'treatment' then raise exception 'Kho bán lẻ chỉ đếm hàng còn nguyên seal'; end if;
      if jsonb_array_length(v_it->'opened') > 50 then raise exception 'Quá nhiều chai đang dở cho 1 sản phẩm'; end if;
      for v_pct in select value from jsonb_array_elements(v_it->'opened') loop
        v_p := round((v_pct #>> '{}')::numeric, 2);
        if v_p is null or v_p <= 0 or v_p > 100 then raise exception 'Mức còn của chai đang dở không hợp lệ'; end if;
        insert into public.stock_count_opened (count_id, product_id, remaining_pct) values (v_id, v_prod, v_p);
      end loop;
    end if;
  end loop;

  if public.has_role('owner') then perform public._apply_stock_count(v_id); end if;
  return v_id;
end $$;
revoke execute on function public.submit_opening_count(uuid, jsonb, text) from public, anon;
grant execute on function public.submit_opening_count(uuid, jsonb, text) to authenticated;
