-- Giai đoạn 5: KHO
-- Mỗi chi nhánh 2 kho: kho bán lẻ (retail) và kho liệu trình (treatment) – bảng warehouses đã có sẵn.
-- Thêm: thông tin sản phẩm (nhãn hàng, dung tích, mã vạch), phiếu nhập, kiểm kê, phiếu xin xuất của KTV,
-- bán lẻ trên màn hình Thu tiền (giá bán thấp nhất = giá niêm yết × (100% − % giảm tối đa)).

-- ============ 1. SẢN PHẨM ============
alter table public.products
  add column brand text,                                   -- nhãn hàng
  add column capacity text,                                -- dung tích / quy cách: "500ml", "Hộp 10 ống x 5ml"
  add column volume numeric(12,2) check (volume >= 0),     -- tổng dung tích (ml / g / cái)
  add column barcode text unique,                          -- mã vạch trên vỏ hộp
  add column category text,                                -- nhóm sản phẩm
  add column used_in text,                                 -- dùng trong liệu trình nào
  add column cost_price numeric(12,0) check (cost_price >= 0), -- giá nhập (chỉ chủ / quản lý / kho xem)
  add column for_treatment boolean not null default false, -- hàng làm liệu trình
  add column for_retail boolean not null default false,    -- hàng bán lẻ
  add column max_staff_discount_pct numeric(5,2) check (max_staff_discount_pct between 0 and 100), -- bỏ trống = theo mức chung
  add column min_stock int not null default 0 check (min_stock >= 0), -- báo sắp hết khi tồn ≤ số này
  add column note text,
  add column updated_at timestamptz not null default now();

create index on public.products (brand);

-- giá nhập là thông tin nội bộ: KTV / lễ tân không đọc được
revoke select on public.products from anon, authenticated;
grant select (id, sku, name, unit, retail_price, is_active, created_at, brand, capacity, volume, barcode, category,
              used_in, for_treatment, for_retail, max_staff_discount_pct, min_stock, note, updated_at)
  on public.products to authenticated;

create or replace function public.product_costs()
returns table (product_id uuid, cost_price numeric) language sql stable security definer set search_path = '' as $$
  select id, cost_price from public.products where public.has_role('owner','manager','warehouse')
$$;
revoke execute on function public.product_costs() from public, anon;
grant execute on function public.product_costs() to authenticated;

-- mã vạch: bỏ khoảng trắng; chuỗi rỗng = không có
create or replace function public.products_normalize()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.barcode := nullif(regexp_replace(coalesce(new.barcode, ''), '\s', '', 'g'), '');
  new.brand := nullif(trim(new.brand), '');
  new.name := trim(new.name);
  new.capacity := nullif(trim(new.capacity), '');
  if new.name = '' then raise exception 'Vui lòng nhập tên sản phẩm'; end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.products_normalize() from public, anon, authenticated;
create trigger products_biu_normalize before insert or update on public.products
for each row execute function public.products_normalize();

-- ============ 2. CÀI ĐẶT CHUNG ============
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
create policy "staff read" on public.app_settings for select to authenticated using ((select public.is_staff()));
insert into public.app_settings (key, value) values ('retail_staff_max_discount_pct', '30');

create or replace function public.set_retail_max_discount(p_pct numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa được đổi mức giảm tối đa'; end if;
  if p_pct is null or p_pct < 0 or p_pct > 100 then raise exception 'Phần trăm phải từ 0 đến 100'; end if;
  insert into public.app_settings (key, value, updated_by, updated_at)
  values ('retail_staff_max_discount_pct', to_jsonb(p_pct), (select auth.uid()), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
end $$;
revoke execute on function public.set_retail_max_discount(numeric) from public, anon;
grant execute on function public.set_retail_max_discount(numeric) to authenticated;

-- giá bán lẻ thấp nhất nhân viên được bán (giao diện tính y hệt)
create or replace function public.retail_min_price(p_list numeric, p_pct numeric)
returns numeric language sql stable security definer set search_path = '' as $$
  select round(p_list * (100 - least(100, greatest(0, coalesce(
    p_pct,
    (select (value #>> '{}')::numeric from public.app_settings where key = 'retail_staff_max_discount_pct'),
    0)))) / 100)
$$;
revoke execute on function public.retail_min_price(numeric, numeric) from public, anon;
grant execute on function public.retail_min_price(numeric, numeric) to authenticated;

-- ============ 3. QUYỀN KHO ============
-- chủ / quản lý: mọi kho; quản lý kho: kho của chi nhánh mình
create or replace function public.can_manage_warehouse(p_wh uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.role in ('owner','manager') or (p.role = 'warehouse' and p.branch_id = w.branch_id)
      from public.profiles p, public.warehouses w
     where p.id = (select auth.uid()) and p.is_active and w.id = p_wh), false)
$$;
revoke execute on function public.can_manage_warehouse(uuid) from public, anon;
grant execute on function public.can_manage_warehouse(uuid) to authenticated;

-- giá vốn trên từng lần nhập: chỉ người quản lý kho xem
revoke select on public.stock_movements from anon, authenticated;
grant select (id, warehouse_id, product_id, movement_type, quantity, request_id, invoice_item_id, note, created_by, created_at)
  on public.stock_movements to authenticated;

-- ============ 4. PHIẾU NHẬP ============
create sequence public.stock_receipt_code_seq;
create table public.stock_receipts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('PN' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMMDD') || '-' || lpad(nextval('public.stock_receipt_code_seq')::text, 4, '0')),
  warehouse_id uuid not null references public.warehouses(id),
  supplier text,
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.stock_receipts (warehouse_id, created_at);
create index on public.stock_receipts (created_by);
alter table public.stock_receipts enable row level security;
create policy "staff read" on public.stock_receipts for select to authenticated using ((select public.is_staff()));

alter table public.stock_movements add column receipt_id uuid references public.stock_receipts(id);
grant select (receipt_id) on public.stock_movements to authenticated;
create index on public.stock_movements (receipt_id);
create index on public.stock_movements (warehouse_id, created_at);

-- p_items: [{"product_id": "...", "quantity": 3, "unit_cost": 250000}]
create or replace function public.receive_stock(p_warehouse_id uuid, p_supplier text, p_note text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_code text;
  v_type public.warehouse_type;
  v_it jsonb;
  v_qty int;
  v_cost numeric;
  v_prod uuid;
begin
  if not public.can_manage_warehouse(p_warehouse_id) then raise exception 'Bạn không có quyền nhập hàng vào kho này'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Phiếu nhập chưa có sản phẩm';
  end if;
  select type into v_type from public.warehouses where id = p_warehouse_id;

  insert into public.stock_receipts (warehouse_id, supplier, note)
  values (p_warehouse_id, nullif(trim(p_supplier), ''), nullif(trim(p_note), ''))
  returning id, code into v_id, v_code;

  for v_it in select value from jsonb_array_elements(p_items) loop
    v_prod := (v_it->>'product_id')::uuid;
    v_qty := (v_it->>'quantity')::int;
    v_cost := round(nullif(v_it->>'unit_cost', '')::numeric);
    if v_qty is null or v_qty < 1 or v_qty > 100000 then raise exception 'Số lượng nhập không hợp lệ'; end if;
    if v_cost is not null and v_cost < 0 then raise exception 'Giá nhập không hợp lệ'; end if;
    if not exists (select 1 from public.products where id = v_prod) then raise exception 'Sản phẩm không tồn tại'; end if;
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
revoke execute on function public.receive_stock(uuid, text, text, jsonb) from public, anon;
grant execute on function public.receive_stock(uuid, text, text, jsonb) to authenticated;

-- kiểm kê: nhập số đếm thực tế, hệ thống ghi phần chênh lệch
create or replace function public.adjust_stock(p_warehouse_id uuid, p_product_id uuid, p_counted int, p_reason text)
returns int language plpgsql security definer set search_path = '' as $$
declare v_qty int; v_diff int;
begin
  if not public.can_manage_warehouse(p_warehouse_id) then raise exception 'Bạn không có quyền kiểm kê kho này'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Số đếm thực tế không hợp lệ'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Vui lòng ghi lý do điều chỉnh'; end if;
  perform pg_advisory_xact_lock(hashtext(p_warehouse_id::text || p_product_id::text));
  select coalesce(sum(quantity), 0) into v_qty from public.stock_movements
   where warehouse_id = p_warehouse_id and product_id = p_product_id;
  v_diff := p_counted - v_qty;
  if v_diff <> 0 then
    insert into public.stock_movements (warehouse_id, product_id, movement_type, quantity, note)
    values (p_warehouse_id, p_product_id, 'adjustment', v_diff, 'Kiểm kê: ' || trim(p_reason));
  end if;
  return v_diff;
end $$;
revoke execute on function public.adjust_stock(uuid, uuid, int, text) from public, anon;
grant execute on function public.adjust_stock(uuid, uuid, int, text) to authenticated;

-- ============ 5. PHIẾU XIN XUẤT (KTV) ============
create sequence public.stock_request_code_seq;
alter table public.stock_requests
  add column code text unique default ('XK' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMMDD') || '-' || lpad(nextval('public.stock_request_code_seq')::text, 4, '0'));
update public.stock_requests set code = default where code is null;
alter table public.stock_requests alter column code set not null;

-- p_items: [{"product_id": "...", "quantity": 1}]
create or replace function public.create_stock_request(p_branch_id uuid, p_items jsonb, p_reason text, p_appointment_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me record;
  v_wh uuid;
  v_id uuid;
  v_it jsonb;
  v_qty int;
  v_have int;
  v_name text;
begin
  select role, branch_id into v_me from public.profiles where id = (select auth.uid()) and is_active;
  if v_me.role is null or v_me.role not in ('owner','manager','technician','receptionist','warehouse') then
    raise exception 'Bạn không có quyền xin xuất hàng';
  end if;
  if v_me.role in ('technician','receptionist','warehouse') then p_branch_id := v_me.branch_id; end if;
  if p_branch_id is null then raise exception 'Chưa chọn chi nhánh'; end if;
  select id into v_wh from public.warehouses where branch_id = p_branch_id and type = 'treatment';
  if v_wh is null then raise exception 'Chi nhánh chưa có kho liệu trình'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Phiếu chưa có sản phẩm';
  end if;

  insert into public.stock_requests (warehouse_id, requested_by, appointment_id, reason)
  values (v_wh, (select auth.uid()), p_appointment_id, nullif(trim(p_reason), ''))
  returning id into v_id;

  for v_it in select value from jsonb_array_elements(p_items) loop
    v_qty := (v_it->>'quantity')::int;
    if v_qty is null or v_qty < 1 or v_qty > 1000 then raise exception 'Số lượng không hợp lệ'; end if;
    select name into v_name from public.products where id = (v_it->>'product_id')::uuid and is_active;
    if v_name is null then raise exception 'Sản phẩm không tồn tại hoặc đã ngừng dùng'; end if;
    select coalesce(sum(quantity), 0) into v_have from public.stock_movements
     where warehouse_id = v_wh and product_id = (v_it->>'product_id')::uuid;
    if v_have < v_qty then raise exception 'Kho liệu trình chỉ còn % "%"', v_have, v_name; end if;
    insert into public.stock_request_items (request_id, product_id, quantity)
    values (v_id, (v_it->>'product_id')::uuid, v_qty)
    on conflict (request_id, product_id) do update set quantity = public.stock_request_items.quantity + excluded.quantity;
  end loop;
  return v_id;
end $$;
revoke execute on function public.create_stock_request(uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.create_stock_request(uuid, jsonb, text, uuid) to authenticated;

-- quản lý kho duyệt / từ chối (duyệt thì tự trừ kho liệu trình – trigger stock_requests_review)
create or replace function public.review_stock_request(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_req record;
begin
  select * into v_req from public.stock_requests where id = p_id for update;
  if not found then raise exception 'Không tìm thấy phiếu'; end if;
  if not public.can_manage_warehouse(v_req.warehouse_id) then raise exception 'Chỉ quản lý kho của chi nhánh được duyệt phiếu'; end if;
  if v_req.status <> 'pending' then raise exception 'Phiếu đã được xử lý'; end if;
  if not p_approve and nullif(trim(p_note), '') is null then raise exception 'Vui lòng ghi lý do từ chối'; end if;
  update public.stock_requests
     set status = case when p_approve then 'approved' else 'rejected' end::public.request_status,
         review_note = nullif(trim(p_note), '')
   where id = p_id;
end $$;
revoke execute on function public.review_stock_request(uuid, boolean, text) from public, anon;
grant execute on function public.review_stock_request(uuid, boolean, text) to authenticated;

create or replace function public.cancel_stock_request(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.stock_requests set status = 'cancelled'
   where id = p_id and status = 'pending' and requested_by = (select auth.uid());
  if not found then raise exception 'Chỉ huỷ được phiếu của mình đang chờ duyệt'; end if;
end $$;
revoke execute on function public.cancel_stock_request(uuid) from public, anon;
grant execute on function public.cancel_stock_request(uuid) to authenticated;

-- KTV xem được tồn kho + phiếu của mình; quản lý kho xem mọi phiếu (policy cũ giữ nguyên)
-- quản lý kho duyệt qua hàm, không sửa trực tiếp
alter policy "stock review" on public.stock_requests using (false) with check (false);

-- tồn kho kèm thông tin sản phẩm (giao diện dùng)
create or replace view public.stock_levels with (security_invoker = true) as
select m.warehouse_id, w.branch_id, w.type as warehouse_type, m.product_id, p.name as product_name, p.unit,
       sum(m.quantity) as quantity
  from public.stock_movements m
  join public.warehouses w on w.id = m.warehouse_id
  join public.products p on p.id = m.product_id
 group by m.warehouse_id, w.branch_id, w.type, m.product_id, p.name, p.unit;
