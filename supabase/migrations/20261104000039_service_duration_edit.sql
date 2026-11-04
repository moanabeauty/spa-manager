-- Chủ / quản lý đổi thời gian làm của 1 dịch vụ trong lịch hẹn (các dịch vụ sau tự dời theo)
create or replace function public.set_appointment_service_minutes(p_id uuid, p_minutes int)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  r record;
  v_status public.appointment_status;
  v_delta interval;
  x record;
begin
  if not public.has_role('owner','manager') then
    raise exception 'Chỉ chủ spa / quản lý đổi được thời gian làm';
  end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 600 then
    raise exception 'Thời gian làm phải từ 5 đến 600 phút';
  end if;
  select * into r from public.appointment_services where id = p_id for update;
  if not found then raise exception 'Không tìm thấy dịch vụ trong lịch'; end if;
  select status into v_status from public.appointments where id = r.appointment_id;
  if v_status in ('cancelled','no_show') then raise exception 'Lịch đã huỷ / khách không đến'; end if;

  v_delta := (r.start_at + make_interval(mins => p_minutes)) - r.end_at;
  if v_delta = interval '0' then return; end if;

  if v_delta > interval '0' then
    -- kéo dài: dời các dịch vụ sau trước (từ cuối lên) để không tự trùng giờ KTV
    for x in select id from public.appointment_services
              where appointment_id = r.appointment_id and id <> r.id and start_at >= r.end_at
              order by start_at desc loop
      update public.appointment_services set start_at = start_at + v_delta, end_at = end_at + v_delta where id = x.id;
    end loop;
    update public.appointment_services set end_at = end_at + v_delta where id = r.id;
  else
    update public.appointment_services set end_at = end_at + v_delta where id = r.id;
    for x in select id from public.appointment_services
              where appointment_id = r.appointment_id and id <> r.id and start_at >= r.end_at
              order by start_at loop
      update public.appointment_services set start_at = start_at + v_delta, end_at = end_at + v_delta where id = x.id;
    end loop;
  end if;

  update public.appointments a
     set end_at = (select max(end_at) from public.appointment_services where appointment_id = a.id)
   where a.id = r.appointment_id;
end $$;
revoke execute on function public.set_appointment_service_minutes(uuid, int) from public, anon;
grant execute on function public.set_appointment_service_minutes(uuid, int) to authenticated;

-- Tạo lịch tại quầy: chủ / quản lý nhập được số phút riêng cho từng dịch vụ (item.minutes)
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
  v_custom int;
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
    v_custom := nullif(v_item->>'minutes', '')::int;
    if v_custom is not null then
      if not v_mgr then raise exception 'Chỉ chủ spa / quản lý đổi được thời gian làm'; end if;
      if v_custom < 5 or v_custom > 600 then raise exception 'Thời gian làm phải từ 5 đến 600 phút'; end if;
      v_dur := v_custom;
    end if;
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
