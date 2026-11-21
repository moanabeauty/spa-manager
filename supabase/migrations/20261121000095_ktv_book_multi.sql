-- KTV đặt 2–3 liệu trình cho cùng 1 khách trong 1 buổi (làm nối tiếp nhau, cùng 1 lịch hẹn).
-- p_items = [{ "service_id": uuid, "package_item_id": uuid|null }, …]; bỏ trống thì dùng p_service_id như cũ.
drop function if exists public.ktv_book(uuid, timestamptz, uuid, text, text, uuid, uuid, text);

create or replace function public.ktv_book(
  p_branch_id uuid, p_start_at timestamptz,
  p_customer_id uuid default null, p_customer_name text default null, p_customer_phone text default null,
  p_service_id uuid default null, p_package_item_id uuid default null, p_note text default null,
  p_items jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_role text := public.my_role()::text;
  v_tech boolean := v_role = 'technician';
  v_customer uuid;
  v_appt uuid;
  v_items jsonb := p_items;
  v_build jsonb := '[]'::jsonb;
  v_it jsonb;
  v_n int;
begin
  if not public.has_role('owner','manager','receptionist','technician','warehouse') then
    raise exception 'Bạn không có quyền đặt lịch';
  end if;
  if v_role in ('technician','warehouse') and p_branch_id is distinct from (select branch_id from public.profiles where id = v_me) then
    raise exception 'Chỉ đặt lịch được ở chi nhánh của mình';
  end if;
  if p_start_at < now() - interval '5 minutes' then raise exception 'Không đặt được giờ đã qua'; end if;

  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    v_items := case when p_service_id is not null
                    then jsonb_build_array(jsonb_build_object('service_id', p_service_id, 'package_item_id', p_package_item_id))
                    else '[]'::jsonb end;
  end if;
  if jsonb_array_length(v_items) > 3 then raise exception 'Mỗi buổi đặt tối đa 3 liệu trình cho 1 khách'; end if;

  if jsonb_array_length(v_items) > 0 then
    for v_it in select value from jsonb_array_elements(v_items) loop
      v_build := v_build || jsonb_build_array(jsonb_build_object(
        'service_id', v_it->>'service_id', 'technician_id', case when v_tech then v_me end));
    end loop;
    v_appt := public.create_staff_booking(
      p_branch_id, p_start_at, 'staff'::public.booking_source, v_build,
      p_customer_id, p_customer_name, p_customer_phone, p_note);
    -- gắn buổi combo theo đúng thứ tự liệu trình (các liệu trình nối tiếp theo giờ bắt đầu)
    with s as (select id, row_number() over (order by start_at, id) rn from public.appointment_services where appointment_id = v_appt),
         i as (select nullif(value->>'package_item_id', '')::uuid pkg, ord rn from jsonb_array_elements(v_items) with ordinality t(value, ord))
    update public.appointment_services a set customer_package_item_id = i.pkg
      from s join i on i.rn = s.rn
     where a.id = s.id and i.pkg is not null;
    -- không dùng 1 phần combo nhiều hơn số buổi còn
    select count(*) into v_n from (
      select nullif(value->>'package_item_id', '')::uuid pkg from jsonb_array_elements(v_items)) x
      join public.customer_package_items ci on ci.id = x.pkg
     where ci.total_qty is not null
     group by ci.id, ci.total_qty, ci.used_qty having count(*) > ci.total_qty - coalesce(ci.used_qty, 0);
    if v_n > 0 then raise exception 'Combo của khách không còn đủ buổi cho số liệu trình đã chọn'; end if;
  else
    v_customer := public._booking_customer(p_customer_id, p_customer_name, p_customer_phone, p_branch_id);
    insert into public.appointments (customer_id, branch_id, start_at, end_at, status, source, note,
                                     is_consultation, consult_technician_id)
    values (v_customer, p_branch_id, p_start_at, p_start_at + interval '60 minutes',
            case when v_tech then 'confirmed' else 'pending' end::public.appointment_status, 'staff',
            nullif(trim(p_note), ''), true, case when v_tech then v_me end)
    returning id into v_appt;
  end if;

  if v_tech then
    update public.appointments set status = case when status = 'pending' then 'confirmed'::public.appointment_status else status end,
            ktv_confirmed_at = coalesce(ktv_confirmed_at, now()), confirmed_by = coalesce(confirmed_by, v_me),
            confirmed_at = coalesce(confirmed_at, now()) where id = v_appt;
  end if;
  return v_appt;
end $$;
revoke execute on function public.ktv_book(uuid, timestamptz, uuid, text, text, uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.ktv_book(uuid, timestamptz, uuid, text, text, uuid, uuid, text, jsonb) to authenticated;
