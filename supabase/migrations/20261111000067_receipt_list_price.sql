-- Phiếu nhập – Chủ duyệt giá (11/11/2026)
--  · Giá niêm yết NCC lưu theo mã sản phẩm, tự điền khi duyệt; chủ sửa trên phiếu → cập nhật luôn vào mã.
--  · Mỗi dòng: Giá niêm yết NCC · Chiết khấu % · Giá nhập · Thành tiền. Có chiết khấu chung cho cả phiếu.
--  · Chủ được sửa phiếu (số lượng, thêm / xoá dòng) trước khi duyệt, hoặc Không duyệt (huỷ cả phiếu, trừ hàng khỏi kho).
-- Các cột giá mới không cấp quyền đọc cho nhân viên (products / stock_movements đã revoke select toàn bảng).

alter table public.products add column supplier_list_price numeric(12,0) check (supplier_list_price >= 0);

alter table public.stock_movements
  add column list_price numeric(12,0),
  add column discount_pct numeric(5,2);

alter table public.stock_receipts drop constraint if exists stock_receipts_status_check;
alter table public.stock_receipts
  add constraint stock_receipts_status_check check (status in ('pending', 'approved', 'rejected')),
  add column discount_pct numeric(5,2),
  add column reject_reason text,
  add column rejected_at timestamptz;
grant select (reject_reason, rejected_at) on public.stock_receipts to authenticated;

-- giá niêm yết NCC chỉ chủ spa / quản lý ghi được
create or replace function public.products_guard_cost()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.has_role('owner','manager') then
    if tg_op = 'INSERT' then new.cost_price := null; new.supplier_list_price := null;
    else new.cost_price := old.cost_price; new.supplier_list_price := old.supplier_list_price; end if;
  end if;
  return new;
end $$;

-- giá niêm yết NCC đang lưu (chủ spa / quản lý)
create or replace function public.product_supplier_prices()
returns table (product_id uuid, supplier_list_price numeric) language sql stable security definer set search_path = '' as $$
  select id, supplier_list_price from public.products where public.has_role('owner','manager') and supplier_list_price is not null
$$;
revoke execute on function public.product_supplier_prices() from public, anon;
grant execute on function public.product_supplier_prices() to authenticated;

-- kiểm tra tồn kho không âm sau khi sửa / huỷ phiếu
create or replace function public._check_stock_not_negative(p_warehouse_id uuid, p_product_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  for v in select p.name, sum(m.quantity) as qty
             from public.stock_movements m join public.products p on p.id = m.product_id
            where m.warehouse_id = p_warehouse_id and m.product_id = any(p_product_ids)
            group by p.name having sum(m.quantity) < 0 loop
    raise exception 'Không thể giảm / huỷ: "%" đã được dùng hoặc bán, tồn kho sẽ bị âm (%)', v.name, v.qty;
  end loop;
end $$;
revoke execute on function public._check_stock_not_negative(uuid, uuid[]) from public, anon, authenticated;

-- Duyệt phiếu (bản mới)
-- p_items: [{"movement_id": "..."|null, "product_id": "...", "quantity": 3, "expiry_date": "2027-12-31"|null,
--            "list_price": 1000000|null, "discount_pct": 40|null, "unit_cost": 600000}]
--   · dòng cũ không còn trong danh sách → xoá; movement_id null → dòng mới chủ thêm.
create or replace function public.approve_stock_receipt_v2(p_receipt_id uuid, p_items jsonb, p_extra_costs jsonb,
  p_supplier text default null, p_paid numeric default 0, p_discount_pct numeric default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_wh uuid;
  v_code text;
  v_type public.warehouse_type;
  v_it jsonb;
  v_extra jsonb := '[]'::jsonb;
  v_extra_total numeric := 0;
  v_amt numeric;
  v_goods numeric := 0;
  v_units int := 0;
  v_n int := 0;
  v_mid uuid;
  v_prod uuid;
  v_qty int;
  v_exp date;
  v_list numeric;
  v_pct numeric;
  v_price numeric;
  v_cost numeric;
  v_keep uuid[] := '{}';
  v_touched uuid[] := '{}';
  v_m record;
  v_payable numeric;
  v_paid numeric := round(coalesce(p_paid, 0));
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa duyệt phiếu nhập'; end if;
  select status, warehouse_id, code into v_status, v_wh, v_code from public.stock_receipts where id = p_receipt_id for update;
  if v_status is null then raise exception 'Không tìm thấy phiếu nhập'; end if;
  if v_status <> 'pending' then raise exception 'Phiếu nhập này đã được xử lý'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Phiếu nhập không có sản phẩm';
  end if;
  select type into v_type from public.warehouses where id = v_wh;
  if p_discount_pct is not null and (p_discount_pct < 0 or p_discount_pct > 100) then raise exception 'Chiết khấu chung không hợp lệ'; end if;

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

  -- 1) ghi / sửa / thêm dòng
  for v_it in select value from jsonb_array_elements(p_items) loop
    v_mid := nullif(v_it->>'movement_id', '')::uuid;
    v_prod := (v_it->>'product_id')::uuid;
    v_qty := (v_it->>'quantity')::int;
    v_exp := nullif(v_it->>'expiry_date', '')::date;
    v_list := round(nullif(v_it->>'list_price', '')::numeric);
    v_pct := nullif(v_it->>'discount_pct', '')::numeric;
    v_price := round(nullif(v_it->>'unit_cost', '')::numeric);
    if v_qty is null or v_qty < 1 or v_qty > 100000 then raise exception 'Số lượng nhập không hợp lệ'; end if;
    if v_price is null or v_price < 0 then raise exception 'Vui lòng nhập đủ giá nhập cho từng sản phẩm'; end if;
    if v_list is not null and v_list < 0 then raise exception 'Giá niêm yết không hợp lệ'; end if;
    if v_pct is not null and (v_pct < 0 or v_pct > 100) then raise exception 'Chiết khấu không hợp lệ'; end if;
    if not exists (select 1 from public.products where id = v_prod) then raise exception 'Sản phẩm không tồn tại'; end if;

    if v_mid is not null then
      if not exists (select 1 from public.stock_movements where id = v_mid and receipt_id = p_receipt_id) then
        raise exception 'Dòng sản phẩm không thuộc phiếu này';
      end if;
      update public.stock_movements
         set product_id = v_prod, quantity = v_qty, expiry_date = v_exp, list_price = v_list, discount_pct = v_pct, unit_cost = v_price
       where id = v_mid;
    else
      insert into public.stock_movements (warehouse_id, product_id, movement_type, quantity, receipt_id, expiry_date, list_price, discount_pct, unit_cost, note)
      values (v_wh, v_prod, 'import', v_qty, p_receipt_id, v_exp, v_list, v_pct, v_price, 'Nhập hàng ' || v_code)
      returning id into v_mid;
      update public.products
         set for_treatment = for_treatment or v_type = 'treatment', for_retail = for_retail or v_type = 'retail', is_active = true
       where id = v_prod;
    end if;
    v_keep := v_keep || v_mid;
    v_touched := v_touched || v_prod;

    -- chủ sửa / nhập giá niêm yết NCC → cập nhật luôn cho mã đó
    if v_list is not null then
      update public.products set supplier_list_price = v_list where id = v_prod and supplier_list_price is distinct from v_list;
    end if;
  end loop;

  -- 2) xoá dòng chủ đã bỏ
  select v_touched || coalesce(array_agg(product_id), '{}') into v_touched
    from public.stock_movements where receipt_id = p_receipt_id and not (id = any(v_keep));
  delete from public.stock_movements where receipt_id = p_receipt_id and not (id = any(v_keep));
  perform public._check_stock_not_negative(v_wh, v_touched);

  -- 3) tổng tiền hàng & phân bổ chi phí vào giá vốn
  for v_m in select quantity, unit_cost from public.stock_movements where receipt_id = p_receipt_id loop
    v_goods := v_goods + v_m.quantity * v_m.unit_cost;
    v_units := v_units + v_m.quantity;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Phiếu nhập không có sản phẩm'; end if;

  for v_m in select id, product_id, unit_cost from public.stock_movements where receipt_id = p_receipt_id order by created_at loop
    v_cost := round(v_m.unit_cost + case when v_extra_total = 0 then 0
                                         when v_goods > 0 then v_extra_total * v_m.unit_cost / v_goods
                                         else v_extra_total / v_units end);
    update public.stock_movements set unit_cost = v_cost where id = v_m.id;
    if v_cost > 0 then update public.products set cost_price = v_cost where id = v_m.product_id; end if;
  end loop;

  -- 4) công nợ NCC: chỉ tiền hàng
  v_payable := v_goods;
  if v_paid < 0 or v_paid > v_payable then raise exception 'Số tiền đã trả phải từ 0 đến số cần trả nhà cung cấp'; end if;
  if v_paid < v_payable and nullif(trim(coalesce(p_supplier, '')), '') is null then
    raise exception 'Vui lòng ghi tên nhà cung cấp để theo dõi công nợ';
  end if;

  update public.stock_receipts
     set status = 'approved', goods_total = v_goods, extra_costs = v_extra, extra_cost_total = v_extra_total,
         payable = v_payable, supplier = nullif(trim(coalesce(p_supplier, '')), ''), discount_pct = p_discount_pct,
         approved_by = auth.uid(), approved_at = now()
   where id = p_receipt_id;

  if v_paid > 0 then
    insert into public.supplier_payments (receipt_id, amount, method, note)
    values (p_receipt_id, v_paid, 'bank_transfer', 'Trả khi duyệt phiếu');
  end if;
end $$;
revoke execute on function public.approve_stock_receipt_v2(uuid, jsonb, jsonb, text, numeric, numeric) from public, anon;
grant execute on function public.approve_stock_receipt_v2(uuid, jsonb, jsonb, text, numeric, numeric) to authenticated;

-- Không duyệt: huỷ cả phiếu, hàng của phiếu bị trừ khỏi kho
create or replace function public.reject_stock_receipt(p_receipt_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status text; v_wh uuid; v_prods uuid[];
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa duyệt phiếu nhập'; end if;
  select status, warehouse_id into v_status, v_wh from public.stock_receipts where id = p_receipt_id for update;
  if v_status is null then raise exception 'Không tìm thấy phiếu nhập'; end if;
  if v_status <> 'pending' then raise exception 'Phiếu nhập này đã được xử lý'; end if;
  select coalesce(array_agg(product_id), '{}') into v_prods from public.stock_movements where receipt_id = p_receipt_id;
  delete from public.stock_movements where receipt_id = p_receipt_id;
  perform public._check_stock_not_negative(v_wh, v_prods);
  update public.stock_receipts
     set status = 'rejected', reject_reason = nullif(trim(coalesce(p_reason, '')), ''), rejected_at = now(),
         approved_by = auth.uid()
   where id = p_receipt_id;
end $$;
revoke execute on function public.reject_stock_receipt(uuid, text) from public, anon;
grant execute on function public.reject_stock_receipt(uuid, text) to authenticated;
