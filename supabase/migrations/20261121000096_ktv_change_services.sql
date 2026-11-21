-- KTV đổi / thêm / bỏ liệu trình của lịch đã đặt (tối đa 10 dịch vụ / buổi).
-- p_items = danh sách liệu trình CHƯA BẮT ĐẦU theo thứ tự làm: [{ "id": aps_id|null, "service_id": uuid, "package_item_id": uuid|null }]
--   có "id" = giữ dòng cũ (giữ điều chỉnh quy trình đã xin), không có = liệu trình mới.
-- Liệu trình đã bắt đầu / đã xong giữ nguyên. Dòng chưa bắt đầu không có trong danh sách → bỏ.
create or replace function public.ktv_set_services(p_appt uuid, p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_appt public.appointments;
  v_me uuid := (select auth.uid());
  v_tech boolean := public.my_role()::text = 'technician';
  v_staff boolean := public.has_role('owner','manager','receptionist');
  v_cursor timestamptz;
  v_it jsonb; v_row public.appointment_services;
  v_dur int; v_id uuid; v_first uuid; v_default_tech uuid; v_n int; v_keep uuid[] := '{}';
begin
  select * into v_appt from public.appointments where id = p_appt for update;
  if not found then raise exception 'Không tìm thấy lịch hẹn'; end if;
  if not (public._is_my_appointment(p_appt) or v_staff) then raise exception 'Đây không phải lịch của bạn'; end if;
  if v_appt.status in ('cancelled','no_show','completed') then raise exception 'Lịch đã đóng, không đổi liệu trình được'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Danh sách liệu trình không hợp lệ'; end if;

  select count(*) into v_n from public.appointment_services
   where appointment_id = p_appt and is_active and work_started_at is not null;
  if v_n + jsonb_array_length(p_items) > 10 then raise exception 'Mỗi buổi tối đa 10 dịch vụ cho 1 khách'; end if;
  if v_n + jsonb_array_length(p_items) = 0 then raise exception 'Chọn ít nhất 1 liệu trình'; end if;

  select array_agg((value->>'id')::uuid) into v_keep from jsonb_array_elements(p_items) where nullif(value->>'id', '') is not null;
  v_keep := coalesce(v_keep, '{}');

  -- bỏ các liệu trình chưa bắt đầu không còn trong danh sách
  for v_row in
    select * from public.appointment_services
     where appointment_id = p_appt and work_started_at is null and not (id = any(v_keep))
  loop
    if v_tech and not v_staff and v_row.technician_id is not null and v_row.technician_id <> v_me then
      raise exception 'Không bỏ được liệu trình của KTV khác – báo quản lý / lễ tân';
    end if;
    if exists (select 1 from public.invoice_items where appointment_service_id = v_row.id) then
      raise exception 'Liệu trình đã lập hoá đơn – không bỏ được, báo lễ tân sửa hoá đơn trước';
    end if;
    delete from public.appointment_services where id = v_row.id;
  end loop;

  -- tạm dời các dòng giữ lại ra xa để xếp lại giờ không bị báo trùng lịch KTV với chính nó
  update public.appointment_services s
     set start_at = timestamptz '2100-01-01' + make_interval(days => x.rn::int),
         end_at = timestamptz '2100-01-01' + make_interval(days => x.rn::int) + (s.end_at - s.start_at)
    from (select id, row_number() over (order by start_at) rn from public.appointment_services
           where appointment_id = p_appt and work_started_at is null and id = any(v_keep)) x
   where s.id = x.id;

  -- KTV mặc định cho liệu trình mới: KTV đang thao tác, hoặc KTV của lịch
  v_default_tech := case when v_tech then v_me else coalesce(
    (select technician_id from public.appointment_services where appointment_id = p_appt and technician_id is not null order by start_at limit 1),
    v_appt.consult_technician_id) end;

  -- xếp lại giờ: nối tiếp sau các liệu trình đã bắt đầu, hoặc từ giờ hẹn
  v_cursor := coalesce((select max(end_at) from public.appointment_services
                         where appointment_id = p_appt and is_active and work_started_at is not null), v_appt.start_at);
  for v_it in select value from jsonb_array_elements(p_items) loop
    if nullif(v_it->>'id', '') is not null then
      select * into v_row from public.appointment_services
       where id = (v_it->>'id')::uuid and appointment_id = p_appt and work_started_at is null;
      if not found then raise exception 'Liệu trình đã bắt đầu hoặc không thuộc lịch này'; end if;
      v_dur := greatest(5, round(extract(epoch from (v_row.end_at - v_row.start_at)) / 60)::int);
      update public.appointment_services
         set start_at = v_cursor, end_at = v_cursor + make_interval(mins => v_dur),
             customer_package_item_id = nullif(v_it->>'package_item_id', '')::uuid
       where id = v_row.id;
      v_id := v_row.id;
    else
      select duration_minutes into v_dur from public.services where id = (v_it->>'service_id')::uuid and is_active;
      if v_dur is null then raise exception 'Dịch vụ không tồn tại hoặc đã ngừng'; end if;
      insert into public.appointment_services (appointment_id, service_id, technician_id, start_at, end_at, customer_package_item_id)
      values (p_appt, (v_it->>'service_id')::uuid, v_default_tech, v_cursor, v_cursor + make_interval(mins => v_dur),
              nullif(v_it->>'package_item_id', '')::uuid)
      returning id into v_id;
    end if;
    v_first := coalesce(v_first, v_id);
    v_cursor := v_cursor + make_interval(mins => v_dur);
  end loop;

  -- combo không dùng quá số buổi còn
  select count(*) into v_n from (
    select ci.id from public.appointment_services s
      join public.customer_package_items ci on ci.id = s.customer_package_item_id
     where s.appointment_id = p_appt and s.work_done_at is null and ci.total_qty is not null
     group by ci.id, ci.total_qty, ci.used_qty having count(*) > ci.total_qty - coalesce(ci.used_qty, 0)) x;
  if v_n > 0 then raise exception 'Combo của khách không còn đủ buổi cho số liệu trình đã chọn'; end if;

  update public.appointments
     set is_consultation = false,
         end_at = greatest(v_cursor, coalesce((select max(end_at) from public.appointment_services where appointment_id = p_appt), v_cursor))
   where id = p_appt;
  return coalesce(v_first, (select id from public.appointment_services where appointment_id = p_appt and work_done_at is null order by start_at limit 1));
end $$;
revoke execute on function public.ktv_set_services(uuid, jsonb) from public, anon;
grant execute on function public.ktv_set_services(uuid, jsonb) to authenticated;

-- Đặt lịch mới: tối đa 10 dịch vụ / buổi (trước là 3)
do $$
begin
  execute replace(replace(pg_get_functiondef('public.ktv_book(uuid,timestamptz,uuid,text,text,uuid,uuid,text,jsonb)'::regprocedure),
    'jsonb_array_length(v_items) > 3', 'jsonb_array_length(v_items) > 10'),
    'tối đa 3 liệu trình', 'tối đa 10 dịch vụ');
end $$;
