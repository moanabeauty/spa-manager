-- Giai đoạn 6: khách hàng & khuyến mãi
-- 1. Chủ / quản lý tạo chương trình khuyến mãi: danh sách món (dịch vụ / gói combo / sản phẩm) kèm giá khuyến mãi
--    (giá 0đ = tặng). Kiểu: giảm giá dịch vụ, gói giá ưu đãi, trải nghiệm lần đầu, mua kèm tặng.
--    Giới hạn: chi nhánh, chỉ khách mới, tổng số suất, số lần / khách, hạn dùng.
-- 2. Khách đăng ký trên web (chờ xác nhận); nhân viên cũng đăng ký hộ được (xác nhận luôn).
-- 3. Lễ tân gọi khách, xác nhận / huỷ (ghi lý do).
-- 4. Thu tiền: áp dụng đăng ký đã xác nhận -> dòng hoá đơn tính đúng giá khuyến mãi (không tính là giảm giá,
--    không cần chủ duyệt). Giảm chung cả hoá đơn không chia vào dòng khuyến mãi. Chốt hoá đơn -> đăng ký "đã dùng";
--    huỷ hoá đơn -> đăng ký về "đã xác nhận" để dùng lại.

-- ============ 1. BẢNG ============
alter table public.promotions
  drop column package_id,
  drop column price,
  add column kind text not null default 'discount'
    check (kind in ('discount','package','first_visit','gift')),
  add column terms text,                                   -- điều kiện áp dụng (hiện cho khách)
  add column branch_id uuid references public.branches(id), -- null = cả 2 chi nhánh
  add column new_customers_only boolean not null default false,
  add column max_slots int check (max_slots > 0),            -- null = không giới hạn
  add column per_customer_limit int not null default 1 check (per_customer_limit > 0),
  add column redeem_until date,                              -- hạn dùng ưu đãi; null = đến ngày kết thúc
  add column show_online boolean not null default true,      -- hiện trên web cho khách tự đăng ký
  add column sort_order int not null default 0,
  add column created_by uuid references public.profiles(id) default auth.uid();
create index on public.promotions (branch_id);

create table public.promotion_items (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  item_type public.invoice_item_type not null check (item_type in ('service','package','product')),
  service_id uuid references public.services(id),
  package_id uuid references public.packages(id),
  product_id uuid references public.products(id),
  label text not null,                       -- tên món lúc lưu (khách không đọc được bảng sản phẩm)
  list_price numeric(12,0),                  -- giá niêm yết lúc lưu (để hiện giá gạch)
  promo_price numeric(12,0) not null check (promo_price >= 0),
  quantity int not null default 1 check (quantity between 1 and 50),
  sort_order int not null default 0,
  check (
    (item_type = 'service' and service_id is not null and package_id is null and product_id is null) or
    (item_type = 'package' and package_id is not null and service_id is null and product_id is null) or
    (item_type = 'product' and product_id is not null and service_id is null and package_id is null)
  )
);
create index on public.promotion_items (promotion_id);
create index on public.promotion_items (service_id);
create index on public.promotion_items (package_id);
create index on public.promotion_items (product_id);

alter table public.promotion_registrations
  add column preferred_at timestamptz,        -- giờ khách muốn đến (không bắt buộc)
  add column source text not null default 'online' check (source in ('online','staff')),
  add column created_by uuid references public.profiles(id) default auth.uid(),
  add column handled_by uuid references public.profiles(id),
  add column handled_at timestamptz,
  add column staff_note text,
  add column cancel_reason text,
  add column used_at timestamptz;
create index on public.promotion_registrations (status, created_at);
create index on public.promotion_registrations (created_by);
create index on public.promotion_registrations (handled_by);

alter table public.invoice_items
  add column promotion_registration_id uuid references public.promotion_registrations(id),
  add column promotion_item_id uuid references public.promotion_items(id) on delete set null;
create index on public.invoice_items (promotion_registration_id);
create index on public.invoice_items (promotion_item_id);

-- ============ 2. QUYỀN ĐỌC ============
-- khách / người chưa đăng nhập chỉ thấy chương trình đang mở trên web; nhân viên thấy tất cả
drop policy "public read" on public.promotions;
create policy "anon read online" on public.promotions for select to anon using (is_active and show_online);
create policy "online or staff read" on public.promotions for select to authenticated
  using ((is_active and show_online) or (select public.is_staff()));

alter table public.promotion_items enable row level security;
create policy "anon read online" on public.promotion_items for select to anon
  using (exists (select 1 from public.promotions p where p.id = promotion_id and p.is_active and p.show_online));
create policy "online or staff read" on public.promotion_items for select to authenticated
  using ((select public.is_staff()) or exists (
    select 1 from public.promotions p where p.id = promotion_id and p.is_active and p.show_online));
create policy "management write" on public.promotion_items for all to authenticated
  using ((select public.has_role('owner','manager'))) with check ((select public.has_role('owner','manager')));

-- đăng ký: chỉ ghi qua các hàm bên dưới (kiểm tra số suất, khách mới, số lần / khách)
drop policy "customer register" on public.promotion_registrations;
drop policy "front desk write" on public.promotion_registrations;

-- ============ 3. SỐ SUẤT ĐÃ ĐĂNG KÝ (công khai) ============
create or replace function public.promotion_taken_counts()
returns table (promotion_id uuid, taken int)
language sql stable security definer set search_path = '' as $$
  select r.promotion_id, count(*)::int from public.promotion_registrations r
    join public.promotions p on p.id = r.promotion_id
   where r.status <> 'cancelled' and (p.is_active and p.show_online or public.is_staff())
   group by r.promotion_id
$$;
revoke execute on function public.promotion_taken_counts() from public;
grant execute on function public.promotion_taken_counts() to anon, authenticated;

-- ============ 4. CHỦ / QUẢN LÝ TẠO, SỬA CHƯƠNG TRÌNH ============
-- p: {"name","description","terms","kind","start_date","end_date","redeem_until","branch_id","new_customers_only",
--     "max_slots","per_customer_limit","show_online","is_active"}
-- p_items: [{"id"?: "...", "type": "service"|"package"|"product", "ref_id": "...", "promo_price": 0, "quantity": 1}]
create or replace function public.save_promotion(p_id uuid, p jsonb, p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_it jsonb;
  v_type text;
  v_ref uuid;
  v_label text;
  v_list numeric;
  v_price numeric;
  v_keep uuid[] := '{}';
  v_item uuid;
  v_ord int := 0;
  v_start date := nullif(p->>'start_date', '')::date;
  v_end date := nullif(p->>'end_date', '')::date;
  v_redeem date := nullif(p->>'redeem_until', '')::date;
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ chủ / quản lý được tạo, sửa khuyến mãi'; end if;
  if nullif(trim(p->>'name'), '') is null then raise exception 'Vui lòng nhập tên chương trình'; end if;
  if coalesce(p->>'kind', '') not in ('discount','package','first_visit','gift') then raise exception 'Chưa chọn kiểu khuyến mãi'; end if;
  if v_end is not null and v_start is not null and v_end < v_start then raise exception 'Ngày kết thúc trước ngày bắt đầu'; end if;
  if v_redeem is not null and v_end is not null and v_redeem < v_end then raise exception 'Hạn dùng không được trước ngày kết thúc đăng ký'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Chương trình cần ít nhất 1 dịch vụ / gói / sản phẩm';
  end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'Tối đa 30 món mỗi chương trình'; end if;

  if v_id is null then
    insert into public.promotions (name) values (trim(p->>'name')) returning id into v_id;
  elsif not exists (select 1 from public.promotions where id = v_id) then
    raise exception 'Không tìm thấy chương trình';
  end if;
  update public.promotions set
    name = trim(p->>'name'),
    description = nullif(trim(p->>'description'), ''),
    terms = nullif(trim(p->>'terms'), ''),
    kind = p->>'kind',
    start_date = v_start, end_date = v_end, redeem_until = v_redeem,
    branch_id = nullif(p->>'branch_id', '')::uuid,
    new_customers_only = coalesce((p->>'new_customers_only')::boolean, p->>'kind' = 'first_visit'),
    max_slots = nullif(p->>'max_slots', '')::int,
    per_customer_limit = coalesce(nullif(p->>'per_customer_limit', '')::int, 1),
    show_online = coalesce((p->>'show_online')::boolean, true),
    is_active = coalesce((p->>'is_active')::boolean, true)
  where id = v_id;

  for v_it in select value from jsonb_array_elements(p_items) loop
    v_ord := v_ord + 1;
    v_type := v_it->>'type';
    v_ref := nullif(v_it->>'ref_id', '')::uuid;
    v_price := round(nullif(v_it->>'promo_price', '')::numeric);
    v_label := null; v_list := null;
    if v_price is null or v_price < 0 then raise exception 'Món thứ % chưa có giá khuyến mãi', v_ord; end if;
    if v_type = 'service' then
      select name, price into v_label, v_list from public.services where id = v_ref;
    elsif v_type = 'package' then
      select 'Gói ' || name, price into v_label, v_list from public.packages where id = v_ref;
    elsif v_type = 'product' then
      select concat_ws(' ', name, capacity), retail_price into v_label, v_list from public.products where id = v_ref;
    else
      raise exception 'Loại món không hợp lệ';
    end if;
    if v_label is null then raise exception 'Món thứ % không tồn tại', v_ord; end if;
    if v_list is not null and v_price > v_list then
      raise exception '"%": giá khuyến mãi cao hơn giá niêm yết', v_label;
    end if;

    v_item := nullif(v_it->>'id', '')::uuid;
    if v_item is not null and exists (select 1 from public.promotion_items where id = v_item and promotion_id = v_id) then
      update public.promotion_items set
        item_type = v_type::public.invoice_item_type,
        service_id = case when v_type = 'service' then v_ref end,
        package_id = case when v_type = 'package' then v_ref end,
        product_id = case when v_type = 'product' then v_ref end,
        label = v_label, list_price = v_list, promo_price = v_price,
        quantity = coalesce(nullif(v_it->>'quantity', '')::int, 1), sort_order = v_ord
      where id = v_item;
    else
      insert into public.promotion_items (promotion_id, item_type, service_id, package_id, product_id,
                                          label, list_price, promo_price, quantity, sort_order)
      values (v_id, v_type::public.invoice_item_type,
              case when v_type = 'service' then v_ref end,
              case when v_type = 'package' then v_ref end,
              case when v_type = 'product' then v_ref end,
              v_label, v_list, v_price, coalesce(nullif(v_it->>'quantity', '')::int, 1), v_ord)
      returning id into v_item;
    end if;
    v_keep := v_keep || v_item;
  end loop;
  delete from public.promotion_items where promotion_id = v_id and not (id = any(v_keep));
  return v_id;
end $$;
revoke execute on function public.save_promotion(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_promotion(uuid, jsonb, jsonb) to authenticated;

-- ============ 5. ĐĂNG KÝ ============
-- Khách tự đăng ký: p_customer_id = null -> "chờ xác nhận".
-- Nhân viên đăng ký hộ: truyền p_customer_id -> "đã xác nhận" luôn.
create or replace function public.register_promotion(
  p_promotion_id uuid, p_branch_id uuid, p_preferred_at timestamptz default null,
  p_note text default null, p_customer_id uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_p record;
  v_staff boolean := public.has_role('owner','manager','receptionist','technician');
  v_cust uuid;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_n int;
  v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Vui lòng đăng nhập để đăng ký'; end if;
  if p_customer_id is not null then
    if not v_staff then raise exception 'Bạn không có quyền đăng ký hộ khách'; end if;
    v_cust := p_customer_id;
  else
    v_cust := public.my_customer_id();
    if v_cust is null then raise exception 'Tài khoản chưa có hồ sơ khách hàng, vui lòng liên hệ lễ tân'; end if;
  end if;

  select * into v_p from public.promotions where id = p_promotion_id for update;  -- khoá để đếm suất chính xác
  if not found or not v_p.is_active then raise exception 'Chương trình không tồn tại hoặc đã dừng'; end if;
  if not v_staff and not v_p.show_online then raise exception 'Chương trình này chỉ đăng ký tại quầy'; end if;
  if v_p.start_date is not null and v_today < v_p.start_date then raise exception 'Chương trình chưa bắt đầu'; end if;
  if v_p.end_date is not null and v_today > v_p.end_date then raise exception 'Chương trình đã hết hạn đăng ký'; end if;

  if p_branch_id is null then p_branch_id := v_p.branch_id; end if;
  if p_branch_id is null then raise exception 'Vui lòng chọn chi nhánh'; end if;
  if not exists (select 1 from public.branches where id = p_branch_id and is_active) then raise exception 'Chi nhánh không hợp lệ'; end if;
  if v_p.branch_id is not null and v_p.branch_id <> p_branch_id then
    raise exception 'Chương trình chỉ áp dụng tại chi nhánh khác';
  end if;
  if p_preferred_at is not null and p_preferred_at < now() then raise exception 'Giờ hẹn phải ở tương lai'; end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'Ghi chú quá dài'; end if;

  if v_p.new_customers_only and (
       exists (select 1 from public.invoices where customer_id = v_cust and status = 'paid')
       or exists (select 1 from public.appointments where customer_id = v_cust and status = 'completed')) then
    raise exception 'Ưu đãi chỉ dành cho khách lần đầu đến Moana';
  end if;

  select count(*) into v_n from public.promotion_registrations
   where promotion_id = p_promotion_id and customer_id = v_cust and status <> 'cancelled';
  if v_n >= v_p.per_customer_limit then
    raise exception 'Bạn đã đăng ký chương trình này (tối đa % lần)', v_p.per_customer_limit;
  end if;
  if v_p.max_slots is not null then
    select count(*) into v_n from public.promotion_registrations
     where promotion_id = p_promotion_id and status <> 'cancelled';
    if v_n >= v_p.max_slots then raise exception 'Chương trình đã hết suất'; end if;
  end if;

  insert into public.promotion_registrations (promotion_id, customer_id, branch_id, status, note, preferred_at, source,
                                              handled_by, handled_at)
  values (p_promotion_id, v_cust, p_branch_id,
          case when p_customer_id is not null then 'confirmed' else 'pending' end::public.registration_status,
          nullif(trim(p_note), ''), p_preferred_at,
          case when p_customer_id is not null then 'staff' else 'online' end,
          case when p_customer_id is not null then (select auth.uid()) end,
          case when p_customer_id is not null then now() end)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.register_promotion(uuid, uuid, timestamptz, text, uuid) from public, anon;
grant execute on function public.register_promotion(uuid, uuid, timestamptz, text, uuid) to authenticated;

-- lễ tân xác nhận (sau khi gọi khách); có thể đổi giờ hẹn / chi nhánh
create or replace function public.confirm_promotion_registration(
  p_id uuid, p_note text default null, p_preferred_at timestamptz default null, p_branch_id uuid default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r record; v_pb uuid;
begin
  if not public.has_role('owner','manager','receptionist','technician') then raise exception 'Bạn không có quyền xác nhận'; end if;
  select * into v_r from public.promotion_registrations where id = p_id for update;
  if not found then raise exception 'Không tìm thấy đăng ký'; end if;
  if v_r.status <> 'pending' then raise exception 'Đăng ký đã được xử lý'; end if;
  if p_branch_id is not null then
    select branch_id into v_pb from public.promotions where id = v_r.promotion_id;
    if v_pb is not null and v_pb <> p_branch_id then raise exception 'Chương trình chỉ áp dụng tại chi nhánh khác'; end if;
  end if;
  update public.promotion_registrations
     set status = 'confirmed', handled_by = (select auth.uid()), handled_at = now(),
         staff_note = coalesce(nullif(trim(p_note), ''), staff_note),
         preferred_at = coalesce(p_preferred_at, preferred_at),
         branch_id = coalesce(p_branch_id, branch_id)
   where id = p_id;
end $$;
revoke execute on function public.confirm_promotion_registration(uuid, text, timestamptz, uuid) from public, anon;
grant execute on function public.confirm_promotion_registration(uuid, text, timestamptz, uuid) to authenticated;

-- huỷ: khách huỷ đăng ký của mình; nhân viên huỷ bất kỳ (bắt buộc lý do)
create or replace function public.cancel_promotion_registration(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r record; v_staff boolean := public.has_role('owner','manager','receptionist','technician');
begin
  select * into v_r from public.promotion_registrations where id = p_id for update;
  if not found then raise exception 'Không tìm thấy đăng ký'; end if;
  if not v_staff and v_r.customer_id is distinct from public.my_customer_id() then
    raise exception 'Bạn không có quyền huỷ đăng ký này';
  end if;
  if v_r.status not in ('pending','confirmed') then raise exception 'Đăng ký đã dùng hoặc đã huỷ'; end if;
  if v_staff and v_r.customer_id is distinct from public.my_customer_id() and nullif(trim(p_reason), '') is null then
    raise exception 'Vui lòng ghi lý do huỷ';
  end if;
  update public.promotion_registrations
     set status = 'cancelled', cancel_reason = coalesce(nullif(trim(p_reason), ''), 'Khách tự huỷ'),
         handled_by = (select auth.uid()), handled_at = now()
   where id = p_id;
end $$;
revoke execute on function public.cancel_promotion_registration(uuid, text) from public, anon;
grant execute on function public.cancel_promotion_registration(uuid, text) to authenticated;

-- ============ 6. KIỂM TRA DÒNG HOÁ ĐƠN DÙNG KHUYẾN MÃI ============
create or replace function public.promotion_line_check(
  p_reg uuid, p_item uuid, p_customer uuid, p_branch uuid, p_type text, p_ref uuid
)
returns table (promo_price numeric, quantity int, promotion_name text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_r record;
  v_i record;
  v_p record;
  v_match boolean;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  select * into v_r from public.promotion_registrations where id = p_reg;
  if not found then raise exception 'Không tìm thấy đăng ký khuyến mãi'; end if;
  if p_customer is null or v_r.customer_id <> p_customer then raise exception 'Đăng ký khuyến mãi thuộc khách khác'; end if;
  if v_r.status <> 'confirmed' then raise exception 'Đăng ký khuyến mãi chưa xác nhận hoặc đã dùng'; end if;
  select * into v_p from public.promotions where id = v_r.promotion_id;
  if v_p.branch_id is not null and v_p.branch_id <> p_branch then
    raise exception 'Khuyến mãi "%" chỉ áp dụng tại chi nhánh khác', v_p.name;
  end if;
  if coalesce(v_p.redeem_until, v_p.end_date) is not null and v_today > coalesce(v_p.redeem_until, v_p.end_date) then
    raise exception 'Khuyến mãi "%" đã hết hạn dùng', v_p.name;
  end if;
  select * into v_i from public.promotion_items where id = p_item and promotion_id = v_r.promotion_id;
  if not found then raise exception 'Món khuyến mãi không thuộc chương trình đã đăng ký'; end if;
  v_match := v_i.item_type::text = p_type
             and p_ref = coalesce(v_i.service_id, v_i.package_id, v_i.product_id);
  if not coalesce(v_match, false) then
    raise exception 'Món trên hoá đơn khác món khuyến mãi "%"', v_i.label;
  end if;
  return query select v_i.promo_price, v_i.quantity, v_p.name;
end $$;
revoke execute on function public.promotion_line_check(uuid, uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.promotion_line_check(uuid, uuid, uuid, uuid, text, uuid) to authenticated;

-- chốt hoá đơn -> đăng ký "đã dùng"; huỷ hoá đơn -> về "đã xác nhận"
create or replace function public.invoices_promotion_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_reg uuid;
begin
  if new.status = 'paid' and old.status = 'draft' then
    for v_reg in select distinct promotion_registration_id from public.invoice_items
                  where invoice_id = new.id and promotion_registration_id is not null loop
      update public.promotion_registrations set status = 'used', invoice_id = new.id, used_at = now()
       where id = v_reg and status = 'confirmed';
      if not found then raise exception 'Đăng ký khuyến mãi đã được dùng ở hoá đơn khác'; end if;
    end loop;
  elsif new.status = 'cancelled' and old.status = 'paid' then
    update public.promotion_registrations set status = 'confirmed', invoice_id = null, used_at = null
     where invoice_id = new.id and status = 'used';
  end if;
  return new;
end $$;
revoke execute on function public.invoices_promotion_status() from public, anon, authenticated;

create trigger invoices_au_promotion after update of status on public.invoices
for each row when (old.status is distinct from new.status)
execute function public.invoices_promotion_status();
