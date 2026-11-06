-- Lịch hẹn tư vấn: khách đến, KTV chọn liệu trình (có thể trừ combo khách đang có)
create or replace function public.ktv_pick_service(p_appt uuid, p_service_id uuid, p_package_item_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_appt public.appointments;
  v_start timestamptz;
  v_dur int;
  v_id uuid;
begin
  select * into v_appt from public.appointments where id = p_appt for update;
  if not found then raise exception 'Không tìm thấy lịch hẹn'; end if;
  if not (public._is_my_appointment(p_appt) or public.has_role('owner','manager','receptionist')) then
    raise exception 'Đây không phải lịch của bạn';
  end if;
  if v_appt.status in ('cancelled','no_show','completed') then raise exception 'Lịch đã đóng'; end if;
  select duration_minutes into v_dur from public.services where id = p_service_id and is_active;
  if v_dur is null then raise exception 'Dịch vụ không tồn tại hoặc đã ngừng'; end if;

  v_start := coalesce((select max(end_at) from public.appointment_services where appointment_id = p_appt and is_active),
                      greatest(v_appt.start_at, date_trunc('minute', now())));
  insert into public.appointment_services (appointment_id, service_id, technician_id, start_at, end_at, customer_package_item_id)
  values (p_appt, p_service_id,
          case when public.my_role()::text = 'technician' then (select auth.uid()) else v_appt.consult_technician_id end,
          v_start, v_start + make_interval(mins => v_dur), p_package_item_id)
  returning id into v_id;
  update public.appointments
     set is_consultation = false,
         end_at = greatest(coalesce(end_at, start_at), v_start + make_interval(mins => v_dur))
   where id = p_appt;
  return v_id;
end $$;
revoke execute on function public.ktv_pick_service(uuid, uuid, uuid) from public, anon;
grant execute on function public.ktv_pick_service(uuid, uuid, uuid) to authenticated;
