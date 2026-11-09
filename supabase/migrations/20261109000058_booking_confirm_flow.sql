-- Quy trình đặt lịch – xác nhận lịch (09/11/2026)
--  * Ai cũng đặt được lịch: khách (online), KTV, lễ tân, quản lý, chủ.
--  * Mọi màn đặt lịch đều có "Chưa chọn liệu trình – Hẹn tư vấn" ở dòng đầu.
--  * Lịch chưa có KTV -> "Chờ xác nhận". Ai cũng bấm Xác nhận được:
--      - KTV bấm xác nhận  -> khách / lịch đó thuộc về KTV đó (gán KTV cho liệu trình hoặc buổi tư vấn).
--      - Vị trí khác bấm   -> bắt buộc chọn KTV làm liệu trình / tư vấn ngay lúc xác nhận.
--  * Lễ tân / quản lý tạo lịch mà đã chọn KTV cho mọi dịch vụ -> coi như đã xác nhận luôn.

alter table public.appointments
  add column if not exists confirmed_by uuid references public.profiles(id),
  add column if not exists confirmed_at timestamptz;

-- người có thể nhận làm liệu trình / tư vấn (giống danh sách KTV ở màn xếp lịch)
create or replace function public._can_serve(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles
                  where id = p_id and is_active
                    and (role in ('technician','manager','owner')
                         or extra_roles && array['technician','manager']::public.user_role[]))
$$;
revoke execute on function public._can_serve(uuid) from public, anon;

-- ===== Xác nhận lịch (dùng chung cho mọi vị trí) =====
create or replace function public.confirm_appointment(p_appt uuid, p_technician_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_tech boolean := public.my_role()::text = 'technician';
  v_appt public.appointments;
  v_target uuid;
  v_consult boolean;
  v_other boolean;
  v_missing boolean;
begin
  if not public.has_role('owner','manager','receptionist','technician') then
    raise exception 'Bạn không có quyền xác nhận lịch';
  end if;
  select * into v_appt from public.appointments where id = p_appt for update;
  if not found then raise exception 'Không tìm thấy lịch hẹn'; end if;
  if v_appt.status not in ('pending','confirmed') then
    raise exception 'Lịch đã huỷ, đang làm hoặc đã hoàn thành';
  end if;
  v_consult := v_appt.is_consultation
               or not exists (select 1 from public.appointment_services s where s.appointment_id = p_appt and s.is_active);

  if v_tech then
    -- KTV bấm xác nhận: nhận khách về mình
    if v_appt.branch_id is distinct from (select branch_id from public.profiles where id = v_me) then
      raise exception 'KTV chỉ nhận lịch ở chi nhánh của mình';
    end if;
    v_other := exists (select 1 from public.appointment_services s
                        where s.appointment_id = p_appt and s.is_active
                          and s.technician_id is not null and s.technician_id <> v_me)
               or (v_appt.consult_technician_id is not null and v_appt.consult_technician_id <> v_me);
    if v_other then raise exception 'Lịch này đã có KTV khác nhận'; end if;
    v_target := v_me;
  else
    v_target := p_technician_id;
    if v_target is not null and not public._can_serve(v_target) then
      raise exception 'Người được chọn không phải KTV đang làm việc';
    end if;
    v_missing := exists (select 1 from public.appointment_services s
                          where s.appointment_id = p_appt and s.is_active and s.technician_id is null)
                 or (v_consult and v_appt.consult_technician_id is null);
    if v_target is null and v_missing then
      raise exception 'Vui lòng chọn KTV làm liệu trình / tư vấn cho khách';
    end if;
  end if;

  if v_target is not null then
    update public.appointment_services set technician_id = v_target
     where appointment_id = p_appt and is_active and technician_id is null;
    if v_consult and v_appt.consult_technician_id is null then
      update public.appointments set consult_technician_id = v_target where id = p_appt;
    end if;
  end if;

  update public.appointments
     set status = 'confirmed',
         ktv_confirmed_at = coalesce(ktv_confirmed_at, now()),
         ktv_confirmed_auto = case when ktv_confirmed_at is null then false else ktv_confirmed_auto end,
         confirmed_by = coalesce(confirmed_by, v_me),
         confirmed_at = coalesce(confirmed_at, now())
   where id = p_appt;
  return coalesce(v_target, v_appt.consult_technician_id);
end $$;
revoke execute on function public.confirm_appointment(uuid, uuid) from public, anon;
grant execute on function public.confirm_appointment(uuid, uuid) to authenticated;

-- nút "Xác nhận lịch" cũ trên app KTV dùng chung logic mới
create or replace function public.ktv_confirm(p_appt uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.confirm_appointment(p_appt, null);
end $$;
revoke execute on function public.ktv_confirm(uuid) from public, anon;
grant execute on function public.ktv_confirm(uuid) to authenticated;

-- ===== Lịch chờ nhận ở chi nhánh của KTV (chưa có KTV nào nhận) – không kèm SĐT =====
create or replace function public.ktv_open_bookings(p_days int default 14)
returns table(appointment_id uuid, start_at timestamptz, end_at timestamptz, customer_name text,
              services text, is_consultation boolean, source text, note text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.start_at, a.end_at, c.full_name,
         coalesce((select string_agg(coalesce(sv.name_en, sv.name), ' + ' order by s.start_at)
                     from public.appointment_services s join public.services sv on sv.id = s.service_id
                    where s.appointment_id = a.id and s.is_active), ''),
         a.is_consultation or not exists (select 1 from public.appointment_services s
                                           where s.appointment_id = a.id and s.is_active),
         a.source::text, a.note
    from public.appointments a
    join public.customers c on c.id = a.customer_id
   where public.has_role('technician')
     and a.branch_id = (select branch_id from public.profiles where id = (select auth.uid()))
     and a.status = 'pending'
     and a.start_at >= now() - interval '2 hours'
     and a.start_at < now() + make_interval(days => least(greatest(coalesce(p_days, 14), 1), 60))
     and a.consult_technician_id is null
     and not exists (select 1 from public.appointment_services s
                      where s.appointment_id = a.id and s.is_active and s.technician_id is not null)
   order by a.start_at
$$;
revoke execute on function public.ktv_open_bookings(int) from public, anon;
grant execute on function public.ktv_open_bookings(int) to authenticated;

-- ===== Lễ tân / quản lý tạo lịch: chưa đủ KTV -> Chờ xác nhận; đủ KTV -> Đã xác nhận =====
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
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := p_customer_id;
  v_phone text := public.normalize_phone(p_customer_phone);
  v_appt uuid;
  v_cursor timestamptz := p_start_at;
  v_item jsonb;
  v_dur int;
  v_custom int;
  v_tech uuid;
  v_all_assigned boolean := true;
  v_mgr boolean := public.has_role('owner','manager');
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
    v_customer := public._customer_id_by_phone(v_phone);
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
          case when p_source = 'walk_in' then 'in_progress' else 'pending' end::public.appointment_status,
          p_source, nullif(trim(p_note), ''))
  returning id into v_appt;

  for v_item in select value from jsonb_array_elements(p_items) loop
    select duration_minutes into v_dur from public.services
     where id = (v_item->>'service_id')::uuid and is_active;
    if v_dur is null then raise exception 'Dịch vụ không tồn tại hoặc đã ngừng'; end if;
    v_custom := nullif(v_item->>'minutes', '')::int;
    if v_custom is not null then
      if not v_mgr then raise exception 'Chỉ chủ spa / quản lý đổi được thời gian làm'; end if;
      if v_custom < 5 or v_custom > 600 then raise exception 'Thời gian làm phải từ 5 đến 600 phút'; end if;
      v_dur := v_custom;
    end if;
    v_tech := nullif(v_item->>'technician_id', '')::uuid;
    if v_tech is null then v_all_assigned := false; end if;
    insert into public.appointment_services (appointment_id, service_id, technician_id, start_at, end_at)
    values (v_appt, (v_item->>'service_id')::uuid, v_tech,
            v_cursor, v_cursor + make_interval(mins => v_dur));
    v_cursor := v_cursor + make_interval(mins => v_dur);
  end loop;

  update public.appointments
     set end_at = v_cursor,
         status = case when p_source <> 'walk_in' and v_all_assigned then 'confirmed'::public.appointment_status else status end,
         ktv_confirmed_at = case when v_all_assigned then now() end,
         confirmed_by = case when v_all_assigned or p_source = 'walk_in' then (select auth.uid()) end,
         confirmed_at = case when v_all_assigned or p_source = 'walk_in' then now() end
   where id = v_appt;
  return v_appt;
end $$;
revoke execute on function public.create_staff_booking(uuid, timestamptz, public.booking_source, jsonb, uuid, text, text, text)
  from public, anon;
grant execute on function public.create_staff_booking(uuid, timestamptz, public.booking_source, jsonb, uuid, text, text, text)
  to authenticated;

-- ===== Lễ tân / quản lý đặt "Chưa chọn liệu trình – Hẹn tư vấn" =====
create or replace function public.staff_book_consult(
  p_branch_id uuid,
  p_start_at timestamptz,
  p_source public.booking_source,
  p_customer_id uuid default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_technician_id uuid default null,
  p_note text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := p_customer_id;
  v_phone text := public.normalize_phone(p_customer_phone);
  v_appt uuid;
  v_ok boolean := p_technician_id is not null;
begin
  if not public.has_role('owner','manager','receptionist','technician') then
    raise exception 'Bạn không có quyền tạo lịch cho khách';
  end if;
  if p_source not in ('phone','walk_in','staff') then raise exception 'Nguồn lịch không hợp lệ'; end if;
  if p_technician_id is not null and not public._can_serve(p_technician_id) then
    raise exception 'Người được chọn không phải KTV đang làm việc';
  end if;
  if v_customer is null then
    if v_phone is null or length(v_phone) < 9 or length(v_phone) > 11 then
      raise exception 'Số điện thoại không hợp lệ';
    end if;
    v_customer := public._customer_id_by_phone(v_phone);
    if v_customer is null then
      if nullif(trim(p_customer_name), '') is null then raise exception 'Vui lòng nhập tên khách mới'; end if;
      insert into public.customers (full_name, phone, home_branch_id)
      values (trim(p_customer_name), v_phone, p_branch_id) returning id into v_customer;
    end if;
  end if;

  insert into public.appointments (customer_id, branch_id, start_at, end_at, status, source, note,
                                   is_consultation, consult_technician_id,
                                   ktv_confirmed_at, confirmed_by, confirmed_at)
  values (v_customer, p_branch_id, p_start_at, p_start_at + interval '60 minutes',
          case when p_source = 'walk_in' then 'in_progress'
               when v_ok then 'confirmed' else 'pending' end::public.appointment_status,
          p_source, nullif(trim(p_note), ''), true, p_technician_id,
          case when v_ok then now() end,
          case when v_ok or p_source = 'walk_in' then (select auth.uid()) end,
          case when v_ok or p_source = 'walk_in' then now() end)
  returning id into v_appt;
  return v_appt;
end $$;
revoke execute on function public.staff_book_consult(uuid, timestamptz, public.booking_source, uuid, text, text, uuid, text) from public, anon;
grant execute on function public.staff_book_consult(uuid, timestamptz, public.booking_source, uuid, text, text, uuid, text) to authenticated;

-- ===== KTV tự đặt lịch: lịch thuộc về KTV đó, ghi người xác nhận =====
do $$
declare d text := pg_get_functiondef('public.ktv_book(uuid,timestamptz,uuid,text,text,uuid,uuid,text)'::regprocedure);
begin
  if position('update public.appointments set ktv_confirmed_at = now() where id = v_appt;' in d) = 0 then
    raise exception 'Không tìm thấy đoạn cần sửa trong ktv_book';
  end if;
  execute replace(d, 'update public.appointments set ktv_confirmed_at = now() where id = v_appt;',
    'update public.appointments set status = case when status = ''pending'' then ''confirmed''::public.appointment_status else status end,
            ktv_confirmed_at = coalesce(ktv_confirmed_at, now()), confirmed_by = coalesce(confirmed_by, v_me),
            confirmed_at = coalesce(confirmed_at, now()) where id = v_appt;');
end $$;
