-- Hàng nhập chỉ cộng vào tồn kho khi Chủ duyệt phiếu (11/11/2026).
-- Dòng hàng của phiếu lưu ở stock_receipt_items; khi duyệt mới tạo stock_movements (nhập kho).
-- Không duyệt: chỉ đổi trạng thái phiếu, kho không thay đổi.

create table public.stock_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.stock_receipts(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity int not null check (quantity > 0),
  expiry_date date,
  list_price numeric(12,0),
  discount_pct numeric(5,2),
  unit_cost numeric(12,0),
  movement_id uuid references public.stock_movements(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.stock_receipt_items (receipt_id);
alter table public.stock_receipt_items enable row level security;
create policy "staff read" on public.stock_receipt_items for select to authenticated using ((select public.is_staff()));
revoke all on public.stock_receipt_items from anon, authenticated;
-- giá chỉ chủ spa xem (qua hàm), nhân viên chỉ đọc sản phẩm / số lượng / HSD
grant select (id, receipt_id, product_id, quantity, expiry_date, movement_id, created_at) on public.stock_receipt_items to authenticated;

-- chuyển dữ liệu cũ: mọi phiếu có dòng hàng tương ứng
insert into public.stock_receipt_items (receipt_id, product_id, quantity, expiry_date, list_price, discount_pct, unit_cost, movement_id, created_at)
select m.receipt_id, m.product_id, m.quantity, m.expiry_date, m.list_price, m.discount_pct, m.unit_cost,
       case when r.status = 'approved' then m.id end, m.created_at
  from public.stock_movements m join public.stock_receipts r on r.id = m.receipt_id;
-- phiếu đang chờ duyệt: rút hàng khỏi kho
delete from public.stock_movements m using public.stock_receipts r
 where r.id = m.receipt_id and r.status = 'pending';

-- Bước 1: kho lập phiếu → chỉ ghi dòng hàng, chưa vào kho
create or replace function public.receive_stock(p_warehouse_id uuid, p_supplier text, p_note text, p_items jsonb, p_extra_costs jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_it jsonb;
  v_qty int;
  v_prod uuid;
  v_exp date;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_extra jsonb := '[]'::jsonb;
  v_extra_total numeric := 0;
  v_amt numeric;
begin
  if not public.can_manage_warehouse(p_warehouse_id) then raise exception 'Bạn không có quyền nhập hàng vào kho này'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Phiếu nhập chưa có sản phẩm';
  end if;

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
  returning id into v_id;

  for v_it in select value from jsonb_array_elements(p_items) loop
    v_prod := (v_it->>'product_id')::uuid;
    v_qty := (v_it->>'quantity')::int;
    v_exp := nullif(v_it->>'expiry_date', '')::date;
    if v_qty is null or v_qty < 1 or v_qty > 100000 then raise exception 'Số lượng nhập không hợp lệ'; end if;
    if v_exp is not null and v_exp <= v_today then raise exception 'Hạn sử dụng phải sau hôm nay'; end if;
    if not exists (select 1 from public.products where id = v_prod) then raise exception 'Sản phẩm không tồn tại'; end if;
    insert into public.stock_receipt_items (receipt_id, product_id, quantity, expiry_date) values (v_id, v_prod, v_qty, v_exp);
  end loop;
  return v_id;
end $$;

-- Bước 2: chủ duyệt → ghi giá, rồi mới nhập kho
drop function if exists public.approve_stock_receipt_v2(uuid, jsonb, jsonb, text, numeric, numeric);
-- p_items: [{"item_id": "..."|null, "product_id": "...", "quantity": 3, "expiry_date": "2027-12-31"|null,
--            "list_price": 1000000|null, "discount_pct": 40|null, "unit_cost": 600000}]
create or replace function public.approve_stock_receipt_v2(p_receipt_id uuid, p_items jsonb, p_extra_costs jsonb,
  p_supplier text default null, p_paid numeric default 0, p_discount_pct numeric default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_wh uuid;
  v_code text;
  v_type public.warehouse_type;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_it jsonb;
  v_extra jsonb := '[]'::jsonb;
  v_extra_total numeric := 0;
  v_amt numeric;
  v_goods numeric := 0;
  v_units int := 0;
  v_n int := 0;
  v_iid uuid;
  v_prod uuid;
  v_qty int;
  v_exp date;
  v_list numeric;
  v_pct numeric;
  v_price numeric;
  v_cost numeric;
  v_keep uuid[] := '{}';
  v_m record;
  v_mid uuid;
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

  -- 1) ghi / sửa / thêm dòng hàng của phiếu
  for v_it in select value from jsonb_array_elements(p_items) loop
    v_iid := nullif(v_it->>'item_id', '')::uuid;
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

    if v_iid is not null then
      if not exists (select 1 from public.stock_receipt_items where id = v_iid and receipt_id = p_receipt_id) then
        raise exception 'Dòng sản phẩm không thuộc phiếu này';
      end if;
      update public.stock_receipt_items
         set product_id = v_prod, quantity = v_qty, expiry_date = v_exp, list_price = v_list, discount_pct = v_pct, unit_cost = v_price
       where id = v_iid;
    else
      insert into public.stock_receipt_items (receipt_id, product_id, quantity, expiry_date, list_price, discount_pct, unit_cost)
      values (p_receipt_id, v_prod, v_qty, v_exp, v_list, v_pct, v_price)
      returning id into v_iid;
    end if;
    v_keep := v_keep || v_iid;

    -- chủ sửa / nhập giá niêm yết NCC → cập nhật luôn cho mã đó
    if v_list is not null then
      update public.products set supplier_list_price = v_list where id = v_prod and supplier_list_price is distinct from v_list;
    end if;
  end loop;
  delete from public.stock_receipt_items where receipt_id = p_receipt_id and not (id = any(v_keep));

  -- 2) tổng tiền hàng
  for v_m in select quantity, unit_cost from public.stock_receipt_items where receipt_id = p_receipt_id loop
    v_goods := v_goods + v_m.quantity * v_m.unit_cost;
    v_units := v_units + v_m.quantity;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Phiếu nhập không có sản phẩm'; end if;

  -- 3) công nợ NCC: chỉ tiền hàng
  v_payable := v_goods;
  if v_paid < 0 or v_paid > v_payable then raise exception 'Số tiền đã trả phải từ 0 đến số cần trả nhà cung cấp'; end if;
  if v_paid < v_payable and nullif(trim(coalesce(p_supplier, '')), '') is null then
    raise exception 'Vui lòng ghi tên nhà cung cấp để theo dõi công nợ';
  end if;

  -- 4) nhập kho: giá vốn = giá nhập + phân bổ chi phí theo tỷ lệ giá trị hàng
  for v_m in select id, product_id, quantity, expiry_date, unit_cost from public.stock_receipt_items
              where receipt_id = p_receipt_id order by created_at loop
    v_cost := round(v_m.unit_cost + case when v_extra_total = 0 then 0
                                         when v_goods > 0 then v_extra_total * v_m.unit_cost / v_goods
                                         else v_extra_total / v_units end);
    insert into public.stock_movements (warehouse_id, product_id, movement_type, quantity, receipt_id, expiry_date, unit_cost, note)
    values (v_wh, v_m.product_id, 'import', v_m.quantity, p_receipt_id, v_m.expiry_date, v_cost, 'Nhập hàng ' || v_code)
    returning id into v_mid;
    update public.stock_receipt_items set movement_id = v_mid where id = v_m.id;
    update public.products
       set cost_price = case when v_cost > 0 then v_cost else cost_price end,
           for_treatment = for_treatment or v_type = 'treatment',
           for_retail = for_retail or v_type = 'retail',
           is_active = true,
           expiry_date = case when v_m.expiry_date is null then expiry_date
                              when expiry_date is null or expiry_date < v_today or v_m.expiry_date < expiry_date then v_m.expiry_date
                              else expiry_date end
     where id = v_m.product_id;
  end loop;

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

-- Không duyệt: chỉ đổi trạng thái, kho không thay đổi (hàng chưa từng vào kho)
create or replace function public.reject_stock_receipt(p_receipt_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa duyệt phiếu nhập'; end if;
  select status into v_status from public.stock_receipts where id = p_receipt_id for update;
  if v_status is null then raise exception 'Không tìm thấy phiếu nhập'; end if;
  if v_status <> 'pending' then raise exception 'Phiếu nhập này đã được xử lý'; end if;
  update public.stock_receipts
     set status = 'rejected', reject_reason = nullif(trim(coalesce(p_reason, '')), ''), rejected_at = now(),
         approved_by = auth.uid()
   where id = p_receipt_id;
end $$;

drop function if exists public._check_stock_not_negative(uuid, uuid[]);
