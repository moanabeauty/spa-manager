-- Phiếu nhập: thêm "Chi phí khác" (tiền ship, bốc xếp…). Chi phí được phân bổ vào giá vốn từng sản phẩm
-- theo tỷ lệ giá trị hàng (nếu chưa nhập giá thì chia theo số lượng), giống cách tính giá vốn nhập kho.
alter table public.stock_receipts
  add column extra_costs jsonb not null default '[]'::jsonb,
  add column extra_cost_total numeric not null default 0;

-- chi phí là thông tin giá vốn: nhân viên thường không đọc được (giống unit_cost của stock_movements)
revoke select on public.stock_receipts from anon, authenticated;
grant select (id, code, warehouse_id, supplier, note, created_by, created_at) on public.stock_receipts to authenticated;

drop function if exists public.receive_stock(uuid, text, text, jsonb);

-- p_items: [{"product_id": "...", "quantity": 3, "unit_cost": 250000}]
-- p_extra_costs: [{"label": "Tiền ship", "amount": 50000}]
create or replace function public.receive_stock(p_warehouse_id uuid, p_supplier text, p_note text, p_items jsonb, p_extra_costs jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_code text;
  v_type public.warehouse_type;
  v_it jsonb;
  v_qty int;
  v_cost numeric;
  v_prod uuid;
  v_extra jsonb := '[]'::jsonb;
  v_extra_total numeric := 0;
  v_amt numeric;
  v_goods numeric := 0;
  v_units int := 0;
  v_alloc numeric;
begin
  if not public.can_manage_warehouse(p_warehouse_id) then raise exception 'Bạn không có quyền nhập hàng vào kho này'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Phiếu nhập chưa có sản phẩm';
  end if;
  select type into v_type from public.warehouses where id = p_warehouse_id;

  -- chi phí khác
  if p_extra_costs is not null and jsonb_typeof(p_extra_costs) = 'array' then
    for v_it in select value from jsonb_array_elements(p_extra_costs) loop
      v_amt := round(coalesce(nullif(v_it->>'amount', '')::numeric, 0));
      if v_amt < 0 then raise exception 'Chi phí khác không hợp lệ'; end if;
      if v_amt > 0 then
        v_extra := v_extra || jsonb_build_object('label', coalesce(nullif(trim(v_it->>'label'), ''), 'Chi phí khác'), 'amount', v_amt);
        v_extra_total := v_extra_total + v_amt;
      end if;
    end loop;
  end if;

  -- tổng giá trị hàng & tổng số lượng (để phân bổ chi phí)
  for v_it in select value from jsonb_array_elements(p_items) loop
    v_qty := (v_it->>'quantity')::int;
    v_cost := round(nullif(v_it->>'unit_cost', '')::numeric);
    if v_qty is null or v_qty < 1 or v_qty > 100000 then raise exception 'Số lượng nhập không hợp lệ'; end if;
    if v_cost is not null and v_cost < 0 then raise exception 'Giá nhập không hợp lệ'; end if;
    v_goods := v_goods + v_qty * coalesce(v_cost, 0);
    v_units := v_units + v_qty;
  end loop;

  insert into public.stock_receipts (warehouse_id, supplier, note, extra_costs, extra_cost_total)
  values (p_warehouse_id, nullif(trim(p_supplier), ''), nullif(trim(p_note), ''), v_extra, v_extra_total)
  returning id, code into v_id, v_code;

  for v_it in select value from jsonb_array_elements(p_items) loop
    v_prod := (v_it->>'product_id')::uuid;
    v_qty := (v_it->>'quantity')::int;
    v_cost := round(nullif(v_it->>'unit_cost', '')::numeric);
    if not exists (select 1 from public.products where id = v_prod) then raise exception 'Sản phẩm không tồn tại'; end if;
    if v_extra_total > 0 then
      v_alloc := case when v_goods > 0 then v_extra_total * coalesce(v_cost, 0) / v_goods
                      else v_extra_total::numeric / v_units end;
      v_cost := round(coalesce(v_cost, 0) + v_alloc);
    end if;
    insert into public.stock_movements (warehouse_id, product_id, movement_type, quantity, receipt_id, unit_cost, note)
    values (p_warehouse_id, v_prod, 'import', v_qty, v_id, v_cost, 'Nhập hàng ' || v_code);
    update public.products
       set cost_price = coalesce(nullif(v_cost, 0), cost_price),
           for_treatment = for_treatment or v_type = 'treatment',
           for_retail = for_retail or v_type = 'retail',
           is_active = true
     where id = v_prod;
  end loop;
  return v_id;
end $$;
revoke execute on function public.receive_stock(uuid, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.receive_stock(uuid, text, text, jsonb, jsonb) to authenticated;
