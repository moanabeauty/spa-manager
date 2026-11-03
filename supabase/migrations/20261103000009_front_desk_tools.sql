-- Giai đoạn 3: công cụ lễ tân + chủ spa
-- 1. Chuẩn hoá SĐT (bỏ dấu cách, +84 -> 0)
-- 2. Lễ tân tạo lịch cho khách gọi điện / vãng lai (tìm hoặc tạo khách theo SĐT) trong 1 bước
-- 3. Xếp KTV: chỉ xếp được tài khoản KTV / quản lý / chủ đang hoạt động, báo rõ tên KTV khi trùng giờ
-- 4. Chủ spa: xem danh sách tài khoản (kèm email), cấp vai trò + chi nhánh, khoá / mở tài khoản

-- ============ 1. SĐT ============
create or replace function public.normalize_phone(p text)
returns text language sql immutable set search_path = '' as $$
  select case
    when d = '' then null
    when d like '84%' and length(d) = 11 then '0' || substr(d, 3)
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;
grant execute on function public.normalize_phone(text) to authenticated;

-- ============ 2. KIỂM TRA KTV KHI XẾP LỊCH ============
-- chạy sau trigger appointment_services_biu (đã tính xong end_at / is_active)
create or replace function public.appointment_services_technician_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ok boolean;
  v_name text;
  v_clash record;
begin
  if new.technician_id is null then return new; end if;
  if tg_op = 'UPDATE'
     and new.technician_id is not distinct from old.technician_id
     and new.start_at = old.start_at and new.end_at = old.end_at
     and new.is_active = old.is_active then
    return new;
  end if;

  select p.is_active and p.role in ('technician','manager','owner'), p.full_name
    into v_ok, v_name
    from public.profiles p where p.id = new.technician_id;
  if not coalesce(v_ok, false) then
    raise exception 'Tài khoản được chọn không phải kỹ thuật viên đang làm việc';
  end if;

  if new.is_active then
    select x.start_at, x.end_at into v_clash
      from public.appointment_services x
     where x.technician_id = new.technician_id and x.is_active and x.id <> new.id
       and tstzrange(x.start_at, x.end_at) && tstzrange(new.start_at, new.end_at)
     order by x.start_at limit 1;
    if found then
      raise exception 'KTV % đã có lịch trùng giờ (% – %)', v_name,
        to_char(v_clash.start_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI'),
        to_char(v_clash.end_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI');
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.appointment_services_technician_check() from public, anon, authenticated;

create trigger appointment_services_tech_check before insert or update on public.appointment_services
for each row execute function public.appointment_services_technician_check();

-- ============ 3. LỄ TÂN TẠO LỊCH ============
-- p_items: [{"service_id": "...", "technician_id": "..." | null}, ...] – làm lần lượt theo thứ tự
-- Khách: truyền p_customer_id (khách đã có) hoặc p_customer_name + p_customer_phone (khách mới;
-- nếu SĐT đã có hồ sơ thì dùng luôn hồ sơ đó).
-- security invoker: vẫn chịu đủ quyền RLS của người gọi (chỉ chủ / quản lý / lễ tân / KTV).
create or replace function public.create_staff_booking(
  p_branch_id uuid,
  p_start_at timestamptz,
  p_source public.booking_source,
  p_items jsonb,
  p_customer_id uuid default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_note text default null
)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_customer uuid := p_customer_id;
  v_phone text := public.normalize_phone(p_customer_phone);
  v_appt uuid;
  v_cursor timestamptz := p_start_at;
  v_item jsonb;
  v_dur int;
begin
  if not public.has_role('owner','manager','receptionist','technician') then
    raise exception 'Bạn không có quyền tạo lịch cho khách';
  end if;
  if p_source not in ('phone','walk_in','staff') then
    raise exception 'Nguồn lịch không hợp lệ';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Vui lòng chọn ít nhất 1 dịch vụ';
  end if;
  if jsonb_array_length(p_items) > 10 then
    raise exception 'Mỗi lịch tối đa 10 dịch vụ';
  end if;

  if v_customer is null then
    if v_phone is null or length(v_phone) < 9 or length(v_phone) > 11 then
      raise exception 'Số điện thoại không hợp lệ';
    end if;
    select id into v_customer from public.customers where phone = v_phone;
    if v_customer is null then
      if nullif(trim(p_customer_name), '') is null then
        raise exception 'Vui lòng nhập tên khách mới';
      end if;
      insert into public.customers (full_name, phone, home_branch_id)
      values (trim(p_customer_name), v_phone, p_branch_id)
      returning id into v_customer;
    end if;
  end if;

  insert into public.appointments (customer_id, branch_id, start_at, status, source, note)
  values (v_customer, p_branch_id, p_start_at,
          case when p_source = 'walk_in' then 'in_progress' else 'confirmed' end::public.appointment_status,
          p_source, nullif(trim(p_note), ''))
  returning id into v_appt;

  for v_item in select value from jsonb_array_elements(p_items) loop
    select duration_minutes into v_dur from public.services
     where id = (v_item->>'service_id')::uuid and is_active;
    if v_dur is null then raise exception 'Dịch vụ không tồn tại hoặc đã ngừng'; end if;
    insert into public.appointment_services (appointment_id, service_id, technician_id, start_at, end_at)
    values (v_appt, (v_item->>'service_id')::uuid, nullif(v_item->>'technician_id', '')::uuid,
            v_cursor, v_cursor + make_interval(mins => v_dur));
    v_cursor := v_cursor + make_interval(mins => v_dur);
  end loop;

  update public.appointments set end_at = v_cursor where id = v_appt;
  return v_appt;
end $$;
revoke execute on function public.create_staff_booking(uuid, timestamptz, public.booking_source, jsonb, uuid, text, text, text)
  from public, anon;
grant execute on function public.create_staff_booking(uuid, timestamptz, public.booking_source, jsonb, uuid, text, text, text)
  to authenticated;

-- ============ 4. CHỦ SPA QUẢN LÝ TÀI KHOẢN ============
create or replace function public.list_accounts()
returns table (
  id uuid, full_name text, phone text, email text, role public.user_role, branch_id uuid,
  is_active boolean, created_at timestamptz, last_sign_in_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.phone, u.email::text, p.role, p.branch_id, p.is_active, p.created_at, u.last_sign_in_at
    from public.profiles p
    join auth.users u on u.id = p.id
   where public.has_role('owner')
   order by (p.role = 'customer'), p.full_name
$$;
revoke execute on function public.list_accounts() from public, anon;
grant execute on function public.list_accounts() to authenticated;

create or replace function public.set_user_role(target_user uuid, new_role public.user_role, new_branch uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('owner') then
    raise exception 'Chỉ chủ spa được đổi vai trò người dùng';
  end if;
  if target_user = (select auth.uid()) then
    raise exception 'Không tự đổi vai trò của chính mình';
  end if;
  if new_role = 'owner' then
    raise exception 'Không cấp quyền chủ spa qua trang này';
  end if;
  if exists (select 1 from public.profiles where id = target_user and role = 'owner') then
    raise exception 'Không đổi được vai trò của tài khoản chủ spa';
  end if;
  if new_role in ('receptionist','technician','warehouse') and new_branch is null then
    raise exception 'Vui lòng chọn chi nhánh cho nhân viên';
  end if;
  update public.profiles
     set role = new_role,
         branch_id = case when new_role = 'customer' then null else new_branch end
   where id = target_user;
  if not found then raise exception 'Không tìm thấy người dùng'; end if;
end $$;
revoke execute on function public.set_user_role(uuid, public.user_role, uuid) from public, anon;
grant execute on function public.set_user_role(uuid, public.user_role, uuid) to authenticated;

create or replace function public.set_user_active(target_user uuid, active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('owner') then
    raise exception 'Chỉ chủ spa được khoá / mở tài khoản';
  end if;
  if target_user = (select auth.uid()) then
    raise exception 'Không tự khoá tài khoản của chính mình';
  end if;
  update public.profiles set is_active = active where id = target_user and role <> 'owner';
  if not found then raise exception 'Không tìm thấy người dùng hoặc không khoá được tài khoản chủ spa'; end if;
end $$;
revoke execute on function public.set_user_active(uuid, boolean) from public, anon;
grant execute on function public.set_user_active(uuid, boolean) to authenticated;

create index if not exists profiles_role_idx on public.profiles (role) where is_active;
