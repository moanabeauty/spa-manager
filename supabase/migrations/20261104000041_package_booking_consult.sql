-- Đặt lịch theo gói khách đang có (gợi ý cách dùng hợp lý nhất), đặt lịch "chưa chọn dịch vụ – tư vấn tại spa",
-- quản lý đổi dịch vụ trên lịch hẹn (A → B) có ghi lại lịch sử, KTV / lễ tân chọn loại cụ thể cho phần gói "các loại".

alter table public.appointments add column if not exists needs_consult boolean not null default false;
alter table public.appointment_services add column if not exists staff_choose boolean not null default false;
alter table public.package_items add column if not exists staff_choice boolean not null default false;
alter table public.customer_package_items add column if not exists staff_choice boolean not null default false;

-- phần gói ghi "các loại …" (Peel / MN 1.900k…): khách không thấy danh sách, KTV chọn tại spa
update public.package_items set staff_choice = true where label ilike '%các loại%' and not staff_choice;
update public.customer_package_items set staff_choice = true where label ilike '%các loại%' and not staff_choice;

create or replace function public.customer_packages_after_insert()
 returns trigger language plpgsql security definer set search_path to ''
as $$
declare r record; v_new uuid;
begin
  for r in select * from public.package_items where package_id = new.package_id order by sort_order loop
    insert into public.customer_package_items (customer_package_id, label, total_qty, unit_price, sort_order, staff_choice)
    values (new.id, r.label, r.quantity, r.unit_price, r.sort_order, r.staff_choice) returning id into v_new;
    insert into public.customer_package_item_services (item_id, service_id)
    select v_new, service_id from public.package_item_services where item_id = r.id;
  end loop;
  return new;
end $$;

-- sửa gói: nhận thêm cờ staff_choice cho từng phần
do $$
declare d text;
begin
  d := pg_get_functiondef('public.save_package(uuid,text,numeric,integer,text,boolean,jsonb)'::regprocedure);
  d := replace(d,
    $x$insert into public.package_items (package_id, label, quantity, unit_price, sort_order)
    values (v_id, coalesce(nullif(trim(v_it->>'label'), ''), 'Phần ' || v_ord),
            nullif(v_it->>'quantity', '')::int, round(nullif(v_it->>'unit_price', '')::numeric), v_ord)$x$,
    $x$insert into public.package_items (package_id, label, quantity, unit_price, sort_order, staff_choice)
    values (v_id, coalesce(nullif(trim(v_it->>'label'), ''), 'Phần ' || v_ord),
            nullif(v_it->>'quantity', '')::int, round(nullif(v_it->>'unit_price', '')::numeric), v_ord,
            coalesce((v_it->>'staff_choice')::boolean, false))$x$);
  if position('staff_choice' in d) = 0 then raise exception 'save_package: không tìm thấy đoạn cần sửa'; end if;
  execute d;
end $$;

-- lịch sử đổi dịch vụ trên lịch hẹn
create table if not exists public.appointment_changes (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  changed_by uuid references public.profiles(id) default auth.uid(),
  before_text text,
  after_text text,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists appointment_changes_appt_idx on public.appointment_changes (appointment_id, created_at);
alter table public.appointment_changes enable row level security;
create policy "staff read" on public.appointment_changes for select to authenticated using ((select public.is_staff()));

-- Các phần gói khách còn dùng được + số buổi đang giữ cho lịch chưa làm
create or replace function public.package_options(p_customer uuid, p_exclude_appt uuid default null)
 returns table(item_id uuid, customer_package_id uuid, package_name text, label text, total_qty int, used_qty int,
               reserved int, left_qty int, expires_at timestamptz, staff_choice boolean, service_ids uuid[], sort_order int)
 language plpgsql stable security definer set search_path to ''
as $$
begin
  if not (public.is_staff() or p_customer = public.my_customer_id()) then
    raise exception 'Không xem được gói của khách này';
  end if;
  return query
  select i.id, cp.id, p.name, i.label, i.total_qty, i.used_qty, r.n,
         case when i.total_qty is null then null else greatest(i.total_qty - i.used_qty - r.n, 0) end,
         cp.expires_at, i.staff_choice,
         coalesce((select array_agg(s.service_id) from public.customer_package_item_services s where s.item_id = i.id), '{}'),
         i.sort_order
    from public.customer_packages cp
    join public.packages p on p.id = cp.package_id
    join public.customer_package_items i on i.customer_package_id = cp.id
    cross join lateral (
      select count(*)::int n from public.appointment_services x join public.appointments a on a.id = x.appointment_id
       where x.customer_package_item_id = i.id and x.is_active
         and a.status in ('pending','confirmed','in_progress')
         and (p_exclude_appt is null or a.id <> p_exclude_appt)) r
   where cp.customer_id = p_customer and cp.is_active and (cp.expires_at is null or cp.expires_at >= now())
   order by cp.expires_at nulls last, cp.purchased_at, i.sort_order;
end $$;
revoke execute on function public.package_options(uuid, uuid) from public, anon;
grant execute on function public.package_options(uuid, uuid) to authenticated;

-- kiểm tra 1 dòng dịch vụ dùng phần gói: đúng khách, còn hạn, có dịch vụ, còn buổi (tính cả buổi đã giữ cho lịch chưa làm)
create or replace function public._check_package_part(p_item uuid, p_service uuid, p_customer uuid, p_start timestamptz)
 returns void language plpgsql security definer set search_path to ''
as $$
declare v record;
begin
  select i.total_qty, i.used_qty, i.label, cp.customer_id, cp.is_active, cp.expires_at,
         exists (select 1 from public.customer_package_item_services s where s.item_id = i.id and s.service_id = p_service) has_svc,
         (select count(*) from public.appointment_services x join public.appointments a on a.id = x.appointment_id
           where x.customer_package_item_id = i.id and x.is_active and a.status in ('pending','confirmed','in_progress')) reserved
    into v
    from public.customer_package_items i join public.customer_packages cp on cp.id = i.customer_package_id
   where i.id = p_item;
  if not found or v.customer_id <> p_customer then raise exception 'Gói không thuộc khách hàng này'; end if;
  if not v.has_svc then raise exception 'Phần gói "%" không có dịch vụ này', v.label; end if;
  if not v.is_active or (v.expires_at is not null and v.expires_at < p_start) then
    raise exception 'Gói đã hết hạn hoặc bị khoá trước ngày hẹn';
  end if;
  if v.total_qty is not null and v.used_qty + v.reserved >= v.total_qty then
    raise exception 'Phần gói "%" đã hết buổi (tính cả các lịch đã đặt chưa làm)', v.label;
  end if;
end $$;
revoke execute on function public._check_package_part(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;

-- dịch vụ mặc định cho phần gói khi khách / lễ tân chưa chọn loại cụ thể (KTV chọn tại spa)
create or replace function public._package_default_service(p_item uuid)
 returns uuid language sql stable security definer set search_path to ''
as $$
  select s.service_id from public.customer_package_item_services s join public.services v on v.id = s.service_id
   where s.item_id = p_item order by v.is_active desc, v.price nulls last, v.name limit 1
$$;
revoke execute on function public._package_default_service(uuid) from public, anon, authenticated;

-- thêm các dòng dịch vụ vào lịch (làm lần lượt), trả giờ kết thúc
create or replace function public._insert_appointment_items(p_appt uuid, p_items jsonb, p_customer uuid, p_branch uuid,
                                                            p_start timestamptz, p_staff boolean)
 returns timestamptz language plpgsql security definer set search_path to ''
as $$
declare
  v_item jsonb;
  v_cursor timestamptz := p_start;
  v_svc uuid;
  v_part uuid;
  v_choose boolean;
  v_dur int;
  v_branch uuid;
  v_active boolean;
begin
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_part := nullif(v_item->>'customer_package_item_id', '')::uuid;
    v_svc := nullif(v_item->>'service_id', '')::uuid;
    v_choose := coalesce((v_item->>'staff_choose')::boolean, false);
    if v_part is null then v_choose := false; end if;
    if v_svc is null then
      if v_part is null then raise exception 'Thiếu dịch vụ'; end if;
      v_svc := public._package_default_service(v_part);
      v_choose := true;
    end if;

    select duration_minutes, branch_id, is_active into v_dur, v_branch, v_active from public.services where id = v_svc;
    if v_dur is null or (not v_active and v_part is null) then raise exception 'Dịch vụ không tồn tại hoặc đã ngừng'; end if;
    if v_branch is not null and v_branch <> p_branch then raise exception 'Dịch vụ không có ở chi nhánh này'; end if;
    if v_part is not null then perform public._check_package_part(v_part, v_svc, p_customer, p_start); end if;

    insert into public.appointment_services (appointment_id, service_id, technician_id, start_at, end_at,
                                             customer_package_item_id, staff_choose)
    values (p_appt, v_svc, case when p_staff then nullif(v_item->>'technician_id', '')::uuid end,
            v_cursor, v_cursor + make_interval(mins => v_dur), v_part, v_choose);
    v_cursor := v_cursor + make_interval(mins => v_dur);
  end loop;
  return v_cursor;
end $$;
revoke execute on function public._insert_appointment_items(uuid, jsonb, uuid, uuid, timestamptz, boolean) from public, anon, authenticated;

-- Khách đặt lịch online (có thể dùng buổi trong gói, hoặc chưa chọn dịch vụ để quản lý tư vấn)
create or replace function public.book_online(p_branch_id uuid, p_start_at timestamptz, p_items jsonb,
                                              p_note text default null, p_consult boolean default false)
 returns uuid language plpgsql security definer set search_path to ''
as $$
declare
  v_customer uuid := public.my_customer_id();
  v_appt uuid;
  v_end timestamptz;
  v_n int := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
begin
  if v_customer is null then raise exception 'Tài khoản chưa có hồ sơ khách hàng'; end if;
  if p_start_at is null or p_start_at <= now() then raise exception 'Vui lòng chọn giờ trong tương lai'; end if;
  if not exists (select 1 from public.branches where id = p_branch_id and is_active) then raise exception 'Chi nhánh không hợp lệ'; end if;
  if v_n = 0 and not coalesce(p_consult, false) then raise exception 'Vui lòng chọn ít nhất 1 dịch vụ hoặc chọn "Chưa chọn dịch vụ"'; end if;
  if v_n > 5 then raise exception 'Mỗi lần đặt tối đa 5 dịch vụ'; end if;

  insert into public.appointments (customer_id, branch_id, start_at, status, source, note, needs_consult)
  values (v_customer, p_branch_id, p_start_at, 'pending', 'online', nullif(left(trim(p_note), 500), ''), coalesce(p_consult, false) or v_n = 0)
  returning id into v_appt;
  v_end := public._insert_appointment_items(v_appt, p_items, v_customer, p_branch_id, p_start_at, false);
  update public.appointments set end_at = case when v_n = 0 then p_start_at + interval '60 minutes' else v_end end where id = v_appt;
  return v_appt;
end $$;
revoke execute on function public.book_online(uuid, timestamptz, jsonb, text, boolean) from public, anon;
grant execute on function public.book_online(uuid, timestamptz, jsonb, text, boolean) to authenticated;

-- Lễ tân / KTV tạo lịch: như create_staff_booking + dùng buổi gói + lịch tư vấn chưa chọn dịch vụ
create or replace function public.create_staff_booking_v2(p_branch_id uuid, p_start_at timestamptz, p_source public.booking_source,
                                                          p_items jsonb, p_customer_id uuid default null, p_customer_name text default null,
                                                          p_customer_phone text default null, p_note text default null,
                                                          p_consult boolean default false)
 returns uuid language plpgsql security definer set search_path to ''
as $$
declare
  v_customer uuid := p_customer_id;
  v_phone text := public.normalize_phone(p_customer_phone);
  v_appt uuid;
  v_end timestamptz;
  v_n int := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
begin
  if not public.has_role('owner','manager','receptionist','technician') then
    raise exception 'Bạn không có quyền tạo lịch cho khách';
  end if;
  if p_source not in ('phone','walk_in','staff') then raise exception 'Nguồn lịch không hợp lệ'; end if;
  if v_n = 0 and not coalesce(p_consult, false) then raise exception 'Vui lòng chọn ít nhất 1 dịch vụ hoặc chọn "Chưa chọn dịch vụ"'; end if;
  if v_n > 10 then raise exception 'Mỗi lịch tối đa 10 dịch vụ'; end if;

  if v_customer is null then
    if v_phone is null or length(v_phone) < 9 or length(v_phone) > 11 then raise exception 'Số điện thoại không hợp lệ'; end if;
    select id into v_customer from public.customers where phone = v_phone;
    if v_customer is null then
      if nullif(trim(p_customer_name), '') is null then raise exception 'Vui lòng nhập tên khách mới'; end if;
      insert into public.customers (full_name, phone, home_branch_id) values (trim(p_customer_name), v_phone, p_branch_id)
      returning id into v_customer;
    end if;
  end if;

  insert into public.appointments (customer_id, branch_id, start_at, status, source, note, needs_consult, created_by)
  values (v_customer, p_branch_id, p_start_at,
          case when p_source = 'walk_in' then 'in_progress' else 'confirmed' end::public.appointment_status,
          p_source, nullif(trim(p_note), ''), coalesce(p_consult, false) or v_n = 0, (select auth.uid()))
  returning id into v_appt;
  v_end := public._insert_appointment_items(v_appt, p_items, v_customer, p_branch_id, p_start_at, true);
  update public.appointments set end_at = case when v_n = 0 then p_start_at + interval '60 minutes' else v_end end where id = v_appt;
  return v_appt;
end $$;
revoke execute on function public.create_staff_booking_v2(uuid, timestamptz, public.booking_source, jsonb, uuid, text, text, text, boolean) from public, anon;
grant execute on function public.create_staff_booking_v2(uuid, timestamptz, public.booking_source, jsonb, uuid, text, text, text, boolean) to authenticated;

-- Quản lý / chủ spa đổi dịch vụ trên lịch (khách đặt A, tư vấn xong làm B); ghi lịch sử
create or replace function public.set_appointment_services(p_appt uuid, p_items jsonb, p_reason text default null)
 returns void language plpgsql security definer set search_path to ''
as $$
declare
  v_appt record;
  v_before text;
  v_after text;
  v_end timestamptz;
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ quản lý / chủ spa được đổi dịch vụ trên lịch hẹn'; end if;
  select * into v_appt from public.appointments where id = p_appt for update;
  if not found then raise exception 'Không tìm thấy lịch hẹn'; end if;
  if v_appt.status in ('completed','cancelled','no_show') then raise exception 'Lịch đã hoàn thành / huỷ, không đổi dịch vụ được'; end if;
  if exists (select 1 from public.invoices where appointment_id = p_appt and status <> 'cancelled') then
    raise exception 'Lịch hẹn đã thanh toán, không đổi dịch vụ được';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then raise exception 'Vui lòng chọn ít nhất 1 dịch vụ'; end if;
  if jsonb_array_length(p_items) > 10 then raise exception 'Mỗi lịch tối đa 10 dịch vụ'; end if;

  select string_agg(s.name || case when x.customer_package_item_id is not null then ' (gói)' else '' end, ', ' order by x.start_at)
    into v_before
    from public.appointment_services x join public.services s on s.id = x.service_id where x.appointment_id = p_appt;

  delete from public.appointment_services where appointment_id = p_appt;
  v_end := public._insert_appointment_items(p_appt, p_items, v_appt.customer_id, v_appt.branch_id, v_appt.start_at, true);
  update public.appointments set end_at = v_end, needs_consult = false where id = p_appt;

  select string_agg(s.name || case when x.customer_package_item_id is not null then ' (gói)' else '' end, ', ' order by x.start_at)
    into v_after
    from public.appointment_services x join public.services s on s.id = x.service_id where x.appointment_id = p_appt;

  insert into public.appointment_changes (appointment_id, before_text, after_text, reason)
  values (p_appt, coalesce(v_before, 'Chưa chọn dịch vụ (tư vấn)'), v_after, nullif(trim(p_reason), ''));
end $$;
revoke execute on function public.set_appointment_services(uuid, jsonb, text) from public, anon;
grant execute on function public.set_appointment_services(uuid, jsonb, text) to authenticated;

-- KTV / lễ tân chọn loại cụ thể cho phần gói "các loại" (vd Peel 1.900k nào) – chỉ trong các dịch vụ của phần đó
create or replace function public.choose_package_service(p_row uuid, p_service uuid)
 returns void language plpgsql security definer set search_path to ''
as $$
declare v record; v_dur int;
begin
  if not public.has_role('owner','manager','receptionist','technician') then raise exception 'Bạn không có quyền'; end if;
  select x.*, a.status into v from public.appointment_services x join public.appointments a on a.id = x.appointment_id where x.id = p_row;
  if not found then raise exception 'Không tìm thấy dịch vụ trong lịch'; end if;
  if v.customer_package_item_id is null then raise exception 'Dịch vụ này không trừ gói'; end if;
  if v.status in ('completed','cancelled','no_show') then raise exception 'Lịch đã hoàn thành / huỷ'; end if;
  if not exists (select 1 from public.customer_package_item_services where item_id = v.customer_package_item_id and service_id = p_service) then
    raise exception 'Dịch vụ không nằm trong phần gói này';
  end if;
  select duration_minutes into v_dur from public.services where id = p_service;
  update public.appointment_services
     set service_id = p_service, staff_choose = false, end_at = start_at + make_interval(mins => v_dur),
         price = (select price from public.services where id = p_service),
         technician_fee = (select technician_fee from public.services where id = p_service)
   where id = p_row;
end $$;
revoke execute on function public.choose_package_service(uuid, uuid) from public, anon;
grant execute on function public.choose_package_service(uuid, uuid) to authenticated;
