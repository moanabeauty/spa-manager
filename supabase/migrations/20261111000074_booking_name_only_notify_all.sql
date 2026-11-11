-- 074: Đặt lịch chỉ cần TÊN khách (SĐT để trống được) · NV Kho cũng đặt lịch được
--      · Lịch hẹn mới -> báo cho toàn bộ KTV, Lễ tân, Quản lý, NV Kho (+ chủ spa) của chi nhánh

-- ========== Khách của lịch: chọn sẵn / tìm theo SĐT / tạo mới chỉ với tên ==========
create or replace function public._booking_customer(p_customer_id uuid, p_name text, p_phone text, p_branch uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_phone text := public.normalize_phone(p_phone); v_id uuid;
begin
  if p_customer_id is not null then return p_customer_id; end if;
  if v_phone is not null then
    if length(v_phone) < 9 or length(v_phone) > 11 then raise exception 'Số điện thoại không hợp lệ (9–11 số) – hoặc để trống'; end if;
    v_id := public._customer_id_by_phone(v_phone);
    if v_id is not null then return v_id; end if;
  end if;
  if nullif(trim(p_name), '') is null then raise exception 'Vui lòng nhập tên khách'; end if;
  insert into public.customers (full_name, phone, home_branch_id)
  values (trim(p_name), v_phone, p_branch) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public._booking_customer(uuid, text, text, uuid) from public, anon, authenticated;

-- ========== Lễ tân / quản lý: lịch có dịch vụ ==========
create or replace function public.create_staff_booking(p_branch_id uuid, p_start_at timestamp with time zone, p_source public.booking_source, p_items jsonb, p_customer_id uuid default null, p_customer_name text default null, p_customer_phone text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid;
  v_appt uuid;
  v_cursor timestamptz := p_start_at;
  v_item jsonb;
  v_dur int;
  v_custom int;
  v_tech uuid;
  v_all_assigned boolean := true;
  v_mgr boolean := public.has_role('owner','manager');
begin
  if not public.has_role('owner','manager','receptionist','technician','warehouse') then
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

  v_customer := public._booking_customer(p_customer_id, p_customer_name, p_customer_phone, p_branch_id);

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

-- ========== Lễ tân / quản lý: hẹn tư vấn ==========
create or replace function public.staff_book_consult(p_branch_id uuid, p_start_at timestamp with time zone, p_source public.booking_source, p_customer_id uuid default null, p_customer_name text default null, p_customer_phone text default null, p_technician_id uuid default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid;
  v_appt uuid;
  v_ok boolean := p_technician_id is not null;
begin
  if not public.has_role('owner','manager','receptionist','technician','warehouse') then
    raise exception 'Bạn không có quyền tạo lịch cho khách';
  end if;
  if p_source not in ('phone','walk_in','staff') then raise exception 'Nguồn lịch không hợp lệ'; end if;
  if p_technician_id is not null and not public._can_serve(p_technician_id) then
    raise exception 'Người được chọn không phải KTV đang làm việc';
  end if;
  v_customer := public._booking_customer(p_customer_id, p_customer_name, p_customer_phone, p_branch_id);

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

-- ========== App KTV + NV Kho: đặt lịch nhanh (chỉ thấy khung giờ trống) ==========
create or replace function public.ktv_book(p_branch_id uuid, p_start_at timestamp with time zone, p_customer_id uuid default null, p_customer_name text default null, p_customer_phone text default null, p_service_id uuid default null, p_package_item_id uuid default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_role text := public.my_role()::text;
  v_tech boolean := v_role = 'technician';
  v_customer uuid;
  v_appt uuid;
begin
  if not public.has_role('owner','manager','receptionist','technician','warehouse') then
    raise exception 'Bạn không có quyền đặt lịch';
  end if;
  if v_role in ('technician','warehouse') and p_branch_id is distinct from (select branch_id from public.profiles where id = v_me) then
    raise exception 'Chỉ đặt lịch được ở chi nhánh của mình';
  end if;
  if p_start_at < now() - interval '5 minutes' then raise exception 'Không đặt được giờ đã qua'; end if;

  if p_service_id is not null then
    v_appt := public.create_staff_booking(
      p_branch_id, p_start_at, 'staff'::public.booking_source,
      jsonb_build_array(jsonb_build_object('service_id', p_service_id, 'technician_id', case when v_tech then v_me end)),
      p_customer_id, p_customer_name, p_customer_phone, p_note);
    if p_package_item_id is not null then
      update public.appointment_services set customer_package_item_id = p_package_item_id where appointment_id = v_appt;
    end if;
  else
    v_customer := public._booking_customer(p_customer_id, p_customer_name, p_customer_phone, p_branch_id);
    -- KTV tự đặt = lịch của KTV đó (đã xác nhận); người khác đặt = Chờ xác nhận, KTV nào nhận trước thì thuộc về KTV đó
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

-- ========== NV Kho cần tìm khách (theo tên / mã KH – không thấy SĐT) để đặt lịch ==========
create or replace function public.search_customers(p_q text, p_limit integer default 8)
returns table(id uuid, code text, full_name text, phone text, note text, home_branch_id uuid, packages_left integer, card_balance numeric, last_visit timestamp with time zone)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := btrim(coalesce(p_q, ''));
  v_fold text := public.vn_fold(btrim(coalesce(p_q, '')));
  v_digits text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g');
  v_code text := upper(regexp_replace(coalesce(p_q, ''), '\s', '', 'g'));
  v_words text[];
  v_see boolean := public.can_view_customer_phone();
  v_min int;
begin
  if not public.is_staff() or public.my_role()::text = 'marketing' then
    raise exception 'Chỉ nhân viên tìm được khách hàng';
  end if;
  if length(v_q) < 2 then return; end if;
  if v_digits like '84%' and length(v_digits) = 11 then v_digits := '0' || substr(v_digits, 3); end if;
  v_min := case when v_see then 3 else 9 end;
  if v_code ~ '^\d{1,5}$' then v_code := 'KH' || lpad(v_code, 5, '0'); end if;
  if v_code ~ '^KH\d{1,5}$' then v_code := 'KH' || lpad(substr(v_code, 3), 5, '0'); end if;
  v_words := array_remove(regexp_split_to_array(v_fold, '\s+'), '');

  return query
  with hits as (
    select c.*,
           case when c.code = v_code then 0
                when length(v_digits) >= v_min and c.phone = v_digits then 1
                when v_see and length(v_digits) >= 3 and c.phone like v_digits || '%' then 2
                when v_see and length(v_digits) >= 3 and c.phone like '%' || v_digits || '%' then 3
                when c.search_name like v_fold || '%' then 4
                else 5 end as rank
      from public.customers c
     where c.code = v_code
        or (length(v_digits) >= v_min and c.phone = v_digits)
        or (v_see and length(v_digits) >= 3 and c.phone like '%' || v_digits || '%')
        or (v_digits = '' and c.code ilike '%' || v_code || '%' and v_code ~ '^KH')
        or (array_length(v_words, 1) > 0
            and not exists (select 1 from unnest(v_words) w where position(w in c.search_name) = 0))
     order by rank, c.full_name
     limit least(greatest(coalesce(p_limit, 8), 1), 30)
  )
  select h.id, h.code, h.full_name,
         case when v_see or h.phone = v_digits then h.phone end,
         h.note, h.home_branch_id,
         (select coalesce(sum(case when i.total_qty is null then 1 else greatest(i.total_qty - i.used_qty, 0) end), 0)::int
            from public.customer_packages cp join public.customer_package_items i on i.customer_package_id = cp.id
           where cp.customer_id = h.id and cp.is_active and (cp.expires_at is null or cp.expires_at >= now())),
         (select coalesce(sum(b.balance), 0) from public.service_card_balances b
            join public.service_cards sc on sc.id = b.card_id and sc.is_active where b.customer_id = h.id),
         (select max(a.start_at) from public.appointments a where a.customer_id = h.id and a.status = 'completed')
    from hits h
   order by h.rank, h.full_name;
end $$;

-- liệu trình trong combo khách đang có (để chọn khi đặt lịch) – NV Kho cũng dùng được
create or replace function public.customer_combo_services(p_customer uuid)
returns table(item_id uuid, package_name text, label text, left_qty integer, service_id uuid)
language sql stable security definer set search_path = '' as $$
  select i.id, p.name, i.label, case when i.total_qty is null then null else i.total_qty - i.used_qty end, s.service_id
    from public.customer_package_items i
    join public.customer_packages cp on cp.id = i.customer_package_id
    join public.packages p on p.id = cp.package_id
    join public.customer_package_item_services s on s.item_id = i.id
   where cp.customer_id = p_customer and cp.is_active
     and (cp.expires_at is null or cp.expires_at > now())
     and (i.total_qty is null or i.used_qty < i.total_qty)
     and (select public.is_staff()) and (select public.my_role()::text) <> 'marketing'
   order by cp.purchased_at, i.sort_order
$$;

-- ========== Thông báo lịch hẹn mới: toàn bộ KTV · Lễ tân · Quản lý · NV Kho (+ chủ spa) của chi nhánh ==========
create or replace function private.on_appointment_created()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  a record; v_sum text; v_ktvs uuid[]; v_open uuid[] := '{}'; v_desk uuid[]; v_rest uuid[];
  v_title text;
begin
  select * into a from public.appointments where id = new.id;
  if not found or a.status in ('cancelled', 'completed', 'no_show') then return null; end if;
  if a.start_at < now() - interval '2 hours' then return null; end if;
  v_sum := public.appointment_summary(a.id);
  v_ktvs := public.appointment_ktvs(a.id);
  v_title := case when a.source = 'online' then 'Có khách đặt lịch online' else 'Có lịch hẹn mới' end;

  -- 1) KTV phụ trách lịch: báo riêng
  if cardinality(v_ktvs) > 0 then
    perform public.notify_users(v_ktvs, 'booking', 'Bạn có lịch khách mới', v_sum,
      '/quan-ly/ktv/lich/' || a.id, 'appt-ktv-' || a.id);
  end if;

  -- 2) Lịch chưa có KTV: mọi KTV chi nhánh thấy "Lịch chờ nhận" (bấm vào để nhận khách)
  if cardinality(v_ktvs) = 0 and a.status = 'pending' then
    v_open := public.staff_recipients(array['technician']::public.user_role[], a.branch_id);
    perform public.notify_users(v_open, 'booking', 'Lịch chờ nhận – bấm để nhận khách', v_sum, '/quan-ly', 'appt-open-' || a.id);
  end if;

  -- 3) Chủ, quản lý, lễ tân: mở trang Lịch hẹn
  v_desk := array(select unnest(public.staff_recipients(array['owner', 'manager', 'receptionist']::public.user_role[], a.branch_id))
                  except select unnest(v_ktvs || v_open));
  perform public.notify_users(v_desk, 'booking', v_title, v_sum, '/quan-ly/lich-hen', 'appt-' || a.id);

  -- 4) Các KTV khác + NV Kho: báo có lịch mới (mở Tổng quan / Hôm nay)
  v_rest := array(select unnest(public.staff_recipients(array['technician', 'warehouse']::public.user_role[], a.branch_id))
                  except select unnest(v_ktvs || v_open || v_desk));
  perform public.notify_users(v_rest, 'booking', v_title, v_sum, '/quan-ly', 'appt-' || a.id);
  return null;
end $$;
