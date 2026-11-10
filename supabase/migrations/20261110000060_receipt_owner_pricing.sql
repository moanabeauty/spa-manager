-- Nhập hàng 2 bước:
--  1) Quản lý kho / quản lý lập phiếu: chỉ sản phẩm + số lượng + chi phí (Tiền ship, Chi phí khác). Hàng vào tồn kho ngay.
--  2) Chủ spa duyệt phiếu: nhập giá nhập từng sản phẩm (có thể sửa chi phí). Chi phí được phân bổ vào giá vốn
--     theo tỷ lệ giá trị hàng; giá vốn sản phẩm cập nhật khi duyệt.
-- Giá nhập chỉ chủ spa / quản lý xem được, quản lý kho không thấy.

alter table public.stock_receipts
  add column status text not null default 'approved' check (status in ('pending', 'approved')),
  add column goods_total numeric,
  add column approved_by uuid references public.profiles(id),
  add column approved_at timestamptz;
alter table public.stock_receipts alter column status set default 'pending';
create index on public.stock_receipts (status);
grant select (status, approved_at) on public.stock_receipts to authenticated;

-- quản lý kho không còn xem giá nhập
create or replace function public.product_costs()
returns table (product_id uuid, cost_price numeric) language sql stable security definer set search_path = '' as $$
  select id, cost_price from public.products where public.has_role('owner','manager')
$$;

-- chặn người không phải chủ/quản lý ghi giá nhập vào sản phẩm (sửa sản phẩm / tạo mới khi quét mã)
create or replace function public.products_guard_cost()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.has_role('owner','manager') then
    if tg_op = 'INSERT' then new.cost_price := null;
    else new.cost_price := old.cost_price; end if;
  end if;
  return new;
end $$;
drop trigger if exists products_guard_cost on public.products;
create trigger products_guard_cost before insert or update on public.products
  for each row execute function public.products_guard_cost();

-- bước 1: lập phiếu (không có giá)
drop function if exists public.receive_stock(uuid, text, text, jsonb, jsonb);
create or replace function public.receive_stock(p_warehouse_id uuid, p_supplier text, p_note text, p_items jsonb, p_extra_costs jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_code text;
  v_type public.warehouse_type;
  v_it jsonb;
  v_qty int;
  v_prod uuid;
  v_extra jsonb := '[]'::jsonb;
  v_extra_total numeric := 0;
  v_amt numeric;
begin
  if not public.can_manage_warehouse(p_warehouse_id) then raise exception 'Bạn không có quyền nhập hàng vào kho này'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Phiếu nhập chưa có sản phẩm';
  end if;
  select type into v_type from public.warehouses where id = p_warehouse_id;

  if p_extra_costs is not null and jsonb_typeof(p_extra_costs) = 'array' then
    for v_it in select value from jsonb_array_elements(p_extra_costs) loop
      v_amt := round(coalesce(nullif(v_it->>'amount', '')::numeric, 0));
      if v_amt < 0 then raise exception 'Chi phí không hợp lệ'; end if;
      if v_amt > 0 then
        v_extra := v_extra || jsonb_build_object('label', coalesce(nullif(trim(v_it->>'label'), ''), 'Chi phí khác'), 'amount', v_amt);
        v_extra_total := v_extra_total + v_amt;
      end if;
    end loop;
  end if;

  insert into public.stock_receipts (warehouse_id, supplier, note, extra_costs, extra_cost_total, status)
  values (p_warehouse_id, nullif(trim(p_supplier), ''), nullif(trim(p_note), ''), v_extra, v_extra_total, 'pending')
  returning id, code into v_id, v_code;

  for v_it in select value from jsonb_array_elements(p_items) loop
    v_prod := (v_it->>'product_id')::uuid;
    v_qty := (v_it->>'quantity')::int;
    if v_qty is null or v_qty < 1 or v_qty > 100000 then raise exception 'Số lượng nhập không hợp lệ'; end if;
    if not exists (select 1 from public.products where id = v_prod) then raise exception 'Sản phẩm không tồn tại'; end if;
    insert into public.stock_movements (warehouse_id, product_id, movement_type, quantity, receipt_id, note)
    values (p_warehouse_id, v_prod, 'import', v_qty, v_id, 'Nhập hàng ' || v_code);
    update public.products
       set for_treatment = for_treatment or v_type = 'treatment',
           for_retail = for_retail or v_type = 'retail',
           is_active = true
     where id = v_prod;
  end loop;
  return v_id;
end $$;
revoke execute on function public.receive_stock(uuid, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.receive_stock(uuid, text, text, jsonb, jsonb) to authenticated;

-- chủ spa xem chi tiết phiếu kèm giá / chi phí
create or replace function public.receipt_costs(p_receipt_ids uuid[])
returns table (receipt_id uuid, extra_costs jsonb, extra_cost_total numeric, goods_total numeric, items jsonb)
language sql stable security definer set search_path = '' as $$
  select r.id, r.extra_costs, r.extra_cost_total, r.goods_total,
         coalesce((select jsonb_agg(jsonb_build_object('movement_id', m.id, 'product_id', m.product_id, 'quantity', m.quantity, 'unit_cost', m.unit_cost)
                                    order by m.created_at)
                     from public.stock_movements m where m.receipt_id = r.id), '[]'::jsonb)
    from public.stock_receipts r
   where r.id = any(p_receipt_ids) and public.has_role('owner')
$$;
revoke execute on function public.receipt_costs(uuid[]) from public, anon;
grant execute on function public.receipt_costs(uuid[]) to authenticated;

-- bước 2: chủ spa nhập giá + duyệt
-- p_prices: [{"movement_id": "...", "unit_cost": 1760000}]  · p_extra_costs như trên (ghi đè chi phí cũ)
create or replace function public.approve_stock_receipt(p_receipt_id uuid, p_prices jsonb, p_extra_costs jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_it jsonb;
  v_extra jsonb := '[]'::jsonb;
  v_extra_total numeric := 0;
  v_amt numeric;
  v_goods numeric := 0;
  v_units int := 0;
  v_m record;
  v_price numeric;
  v_cost numeric;
  v_n int := 0;
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa duyệt phiếu nhập'; end if;
  select status into v_status from public.stock_receipts where id = p_receipt_id for update;
  if v_status is null then raise exception 'Không tìm thấy phiếu nhập'; end if;
  if v_status <> 'pending' then raise exception 'Phiếu nhập này đã được duyệt'; end if;

  if p_extra_costs is not null and jsonb_typeof(p_extra_costs) = 'array' then
    for v_it in select value from jsonb_array_elements(p_extra_costs) loop
      v_amt := round(coalesce(nullif(v_it->>'amount', '')::numeric, 0));
      if v_amt < 0 then raise exception 'Chi phí không hợp lệ'; end if;
      if v_amt > 0 then
        v_extra := v_extra || jsonb_build_object('label', coalesce(nullif(trim(v_it->>'label'), ''), 'Chi phí khác'), 'amount', v_amt);
        v_extra_total := v_extra_total + v_amt;
      end if;
    end loop;
  end if;

  -- giá từng dòng (bắt buộc đủ, cho phép 0 với hàng tặng)
  create temp table _px (movement_id uuid primary key, price numeric) on commit drop;
  for v_it in select value from jsonb_array_elements(coalesce(p_prices, '[]'::jsonb)) loop
    v_price := round(nullif(v_it->>'unit_cost', '')::numeric);
    if v_price is null or v_price < 0 then raise exception 'Vui lòng nhập đủ giá nhập cho từng sản phẩm'; end if;
    insert into _px values ((v_it->>'movement_id')::uuid, v_price) on conflict (movement_id) do update set price = excluded.price;
  end loop;

  for v_m in select m.id, m.quantity, p.price from public.stock_movements m left join _px p on p.movement_id = m.id
              where m.receipt_id = p_receipt_id loop
    if v_m.price is null then raise exception 'Vui lòng nhập đủ giá nhập cho từng sản phẩm'; end if;
    v_goods := v_goods + v_m.quantity * v_m.price;
    v_units := v_units + v_m.quantity;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Phiếu nhập không có sản phẩm'; end if;

  for v_m in select m.id, m.product_id, m.quantity, p.price from public.stock_movements m join _px p on p.movement_id = m.id
              where m.receipt_id = p_receipt_id order by m.created_at loop
    v_cost := v_m.price + case when v_extra_total = 0 then 0
                               when v_goods > 0 then v_extra_total * v_m.price / v_goods
                               else v_extra_total / v_units end;
    v_cost := round(v_cost);
    update public.stock_movements set unit_cost = v_cost where id = v_m.id;
    if v_cost > 0 then update public.products set cost_price = v_cost where id = v_m.product_id; end if;
  end loop;

  update public.stock_receipts
     set status = 'approved', goods_total = v_goods, extra_costs = v_extra, extra_cost_total = v_extra_total,
         approved_by = auth.uid(), approved_at = now()
   where id = p_receipt_id;
end $$;
revoke execute on function public.approve_stock_receipt(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.approve_stock_receipt(uuid, jsonb, jsonb) to authenticated;
