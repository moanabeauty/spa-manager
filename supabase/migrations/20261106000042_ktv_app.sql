-- App Kỹ thuật viên (KTV): xác nhận lịch + tự nhận, hẹn tư vấn, quy trình liệu trình theo bước,
-- đổi sản phẩm cần quản lý duyệt, chấm công ngoài giờ (vào trước 8:30 / ra sau 18:30).

-- ===== 1. Quy trình gốc của từng dịch vụ (nhập từ tab KTV, sheet "AI QUY TRÌNH LIỆU TRÌNH MOANA 2026") =====
create table if not exists public.service_procedure_steps (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  step_no int not null check (step_no > 0),
  title text not null,
  products text[] not null default '{}',
  instructions text,
  note text,
  unique (service_id, step_no)
);
alter table public.service_procedure_steps enable row level security;
create policy "staff read" on public.service_procedure_steps for select using ((select public.is_staff()));
create policy "management write" on public.service_procedure_steps for all
  using ((select public.has_role('owner','manager'))) with check ((select public.has_role('owner','manager')));

-- ===== 2. Lịch hẹn: KTV xác nhận, lịch hẹn tư vấn =====
alter table public.appointments
  add column if not exists ktv_confirmed_at timestamptz,
  add column if not exists ktv_confirmed_auto boolean not null default false,
  add column if not exists is_consultation boolean not null default false,
  add column if not exists consult_technician_id uuid references public.profiles(id);
create index if not exists appointments_consult_tech_idx on public.appointments (consult_technician_id, start_at);

-- ===== 3. Tiến độ làm liệu trình (quản lý theo dõi thời gian thực) =====
alter table public.appointment_services
  add column if not exists work_started_at timestamptz,
  add column if not exists work_done_at timestamptz,
  add column if not exists steps_done int not null default 0,
  add column if not exists step_log jsonb not null default '[]'::jsonb;
create index if not exists appointment_services_tech_start_idx on public.appointment_services (technician_id, start_at);

-- ===== 4. Đổi sản phẩm khác quy trình gốc -> quản lý duyệt =====
create table if not exists public.procedure_change_requests (
  id uuid primary key default gen_random_uuid(),
  appointment_service_id uuid not null references public.appointment_services(id) on delete cascade,
  step_no int not null,
  from_product text,
  to_product text not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index if not exists procedure_change_requests_aps_idx on public.procedure_change_requests (appointment_service_id);
create index if not exists procedure_change_requests_pending_idx on public.procedure_change_requests (status) where status = 'pending';
alter table public.procedure_change_requests enable row level security;
create policy "own or management read" on public.procedure_change_requests for select
  using (requested_by = (select auth.uid()) or (select public.has_role('owner','manager')));

-- ===== 5. Chấm công ngoài giờ =====
alter table public.staff_attendance
  add column if not exists in_reason_kind text,
  add column if not exists in_appointment_id uuid references public.appointments(id) on delete set null,
  add column if not exists in_note text,
  add column if not exists in_status text not null default 'none',
  add column if not exists in_reviewed_by uuid references public.profiles(id),
  add column if not exists in_reviewed_at timestamptz,
  add column if not exists ot_reason_kind text,
  add column if not exists ot_appointment_id uuid references public.appointments(id) on delete set null,
  add column if not exists ot_note text;
alter table public.staff_attendance drop constraint if exists staff_attendance_in_status_check;
alter table public.staff_attendance add constraint staff_attendance_in_status_check
  check (in_status in ('none','pending','approved','rejected'));

update public.app_settings set value = value || '{"early_start": "08:30"}'::jsonb
 where key = 'payroll' and not (value ? 'early_start');

-- tăng ca tính từ giờ bắt đầu tăng ca (18:30), theo phút thực tế
create or replace function public._ot_hours(p_out timestamptz)
returns numeric language sql stable security definer set search_path = '' as $$
  select case when p_out is null then 0
              when (p_out at time zone 'Asia/Ho_Chi_Minh')::time <= coalesce((value->>'ot_start'), '18:30')::time then 0
              else round((extract(epoch from (p_out at time zone 'Asia/Ho_Chi_Minh')::time
                                          - coalesce((value->>'ot_start'), '18:30')::time) / 3600)::numeric, 2) end
    from public.app_settings where key = 'payroll'
$$;

-- ===== Hàm dùng chung =====
create or replace function public._is_my_appointment(p_appt uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.appointment_services s
                  where s.appointment_id = p_appt and s.technician_id = (select auth.uid()))
      or exists (select 1 from public.appointments a
                  where a.id = p_appt and a.consult_technician_id = (select auth.uid()))
$$;
revoke execute on function public._is_my_appointment(uuid) from public, anon;
grant execute on function public._is_my_appointment(uuid) to authenticated;

-- Đến giờ hẹn mà KTV chưa xác nhận -> hệ thống tự nhận lịch
create or replace function public.ktv_auto_accept()
returns int language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  if not public.is_staff() then return 0; end if;
  update public.appointments a
     set ktv_confirmed_at = a.start_at,
         ktv_confirmed_auto = true,
         status = case when a.status = 'pending' then 'confirmed'::public.appointment_status else a.status end
   where a.ktv_confirmed_at is null
     and a.start_at <= now()
     and a.start_at > now() - interval '3 days'
     and a.status in ('pending','confirmed')
     and (a.consult_technician_id is not null
          or exists (select 1 from public.appointment_services s
                      where s.appointment_id = a.id and s.technician_id is not null and s.is_active));
  get diagnostics v = row_count;
  return v;
end $$;
revoke execute on function public.ktv_auto_accept() from public, anon;
grant execute on function public.ktv_auto_accept() to authenticated;

-- KTV bấm "Xác nhận lịch"
create or replace function public.ktv_confirm(p_appt uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public._is_my_appointment(p_appt) or public.has_role('owner','manager','receptionist')) then
    raise exception 'Đây không phải lịch của bạn';
  end if;
  update public.appointments
     set ktv_confirmed_at = coalesce(ktv_confirmed_at, now()),
         ktv_confirmed_auto = case when ktv_confirmed_at is null then false else ktv_confirmed_auto end,
         status = case when status = 'pending' then 'confirmed'::public.appointment_status else status end
   where id = p_appt and status in ('pending','confirmed','in_progress');
  if not found then raise exception 'Lịch đã huỷ hoặc đã hoàn thành'; end if;
end $$;
revoke execute on function public.ktv_confirm(uuid) from public, anon;
grant execute on function public.ktv_confirm(uuid) to authenticated;

-- Danh sách lịch của KTV trong ngày (kèm cảnh báo thẻ / combo / nợ)
create or replace function public.ktv_my_day(p_date date default null)
returns table(appointment_id uuid, start_at timestamptz, end_at timestamptz, status text, customer_id uuid,
              customer_name text, services text, minutes int, ktv_confirmed_at timestamptz, ktv_confirmed_auto boolean,
              is_consultation boolean, card_balance numeric, combo_min_left int, debt numeric,
              work_started boolean, work_done boolean)
language sql stable security definer set search_path = '' as $$
  with d as (select coalesce(p_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date) as day),
  mine as (
    select a.* from public.appointments a, d
     where a.start_at >= (d.day::timestamp at time zone 'Asia/Ho_Chi_Minh')
       and a.start_at < ((d.day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
       and a.status not in ('cancelled','no_show')
       and (a.consult_technician_id = (select auth.uid())
            or exists (select 1 from public.appointment_services s
                        where s.appointment_id = a.id and s.technician_id = (select auth.uid())))
  )
  select m.id, m.start_at, m.end_at, m.status::text, m.customer_id, c.full_name,
         coalesce((select string_agg(sv.name_en, ' + ' order by s.start_at)
                     from public.appointment_services s join public.services sv on sv.id = s.service_id
                    where s.appointment_id = m.id and s.technician_id = (select auth.uid())), ''),
         coalesce((select sum(extract(epoch from (s.end_at - s.start_at)) / 60)::int
                     from public.appointment_services s
                    where s.appointment_id = m.id and s.technician_id = (select auth.uid())), 0),
         m.ktv_confirmed_at, m.ktv_confirmed_auto,
         m.is_consultation or not exists (select 1 from public.appointment_services s where s.appointment_id = m.id),
         coalesce((select sum(b.balance) from public.service_card_balances b
                     join public.service_cards sc on sc.id = b.card_id
                    where b.customer_id = m.customer_id and sc.is_active), 0),
         (select min(i.total_qty - i.used_qty) from public.customer_package_items i
            join public.customer_packages cp on cp.id = i.customer_package_id
           where cp.customer_id = m.customer_id and cp.is_active and i.total_qty is not null
             and i.used_qty < i.total_qty and (cp.expires_at is null or cp.expires_at > now())),
         coalesce((select sum(x.outstanding) from public.invoice_debts x
                    where x.customer_id = m.customer_id and x.outstanding > 0), 0),
         exists (select 1 from public.appointment_services s where s.appointment_id = m.id
                    and s.technician_id = (select auth.uid()) and s.work_started_at is not null),
         m.status = 'completed' or (exists (select 1 from public.appointment_services s where s.appointment_id = m.id
                    and s.technician_id = (select auth.uid()))
              and not exists (select 1 from public.appointment_services s where s.appointment_id = m.id
                    and s.technician_id = (select auth.uid()) and s.work_done_at is null))
    from mine m join public.customers c on c.id = m.customer_id
   where (select public.is_staff())
   order by m.start_at
$$;
revoke execute on function public.ktv_my_day(date) from public, anon;
grant execute on function public.ktv_my_day(date) to authenticated;

-- Thông tin khách cho KTV (không có SĐT): thẻ, combo còn buổi, nợ, lịch sử, phiếu da gần nhất
create or replace function public.ktv_customer_view(p_appt uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_cust uuid;
begin
  if not (public._is_my_appointment(p_appt) or public.has_role('owner','manager','receptionist')) then
    raise exception 'Bạn chỉ xem được khách của lịch mình phục vụ';
  end if;
  select customer_id into v_cust from public.appointments where id = p_appt;
  if v_cust is null then raise exception 'Không tìm thấy lịch hẹn'; end if;
  return jsonb_build_object(
    'card_balance', coalesce((select sum(b.balance) from public.service_card_balances b
                                join public.service_cards sc on sc.id = b.card_id
                               where b.customer_id = v_cust and sc.is_active), 0),
    'packages', coalesce((select jsonb_agg(jsonb_build_object(
                    'item_id', i.id, 'package', p.name, 'label', i.label,
                    'left', case when i.total_qty is null then null else i.total_qty - i.used_qty end,
                    'expires_at', cp.expires_at) order by cp.purchased_at, i.sort_order)
                  from public.customer_package_items i
                  join public.customer_packages cp on cp.id = i.customer_package_id
                  join public.packages p on p.id = cp.package_id
                 where cp.customer_id = v_cust and cp.is_active
                   and (cp.expires_at is null or cp.expires_at > now())
                   and (i.total_qty is null or i.used_qty < i.total_qty)), '[]'::jsonb),
    'debt', coalesce((select sum(outstanding) from public.invoice_debts where customer_id = v_cust and outstanding > 0), 0),
    'debt_since', (select min(paid_at) from public.invoice_debts where customer_id = v_cust and outstanding > 0),
    'visits', (select count(*) from public.appointments where customer_id = v_cust and status = 'completed'),
    'history', coalesce((select jsonb_agg(to_jsonb(h) order by h.start_at desc) from (
                  select a.start_at,
                         string_agg(distinct sv.name_en, ', ') as services,
                         string_agg(distinct pr.full_name, ', ') as techs
                    from public.appointments a
                    join public.appointment_services s on s.appointment_id = a.id
                    join public.services sv on sv.id = s.service_id
                    left join public.profiles pr on pr.id = s.technician_id
                   where a.customer_id = v_cust and a.status = 'completed'
                   group by a.id, a.start_at
                   order by a.start_at desc limit 5) h), '[]'::jsonb),
    'skin', (select to_jsonb(r) from (
                  select record_date, overall, customer_needs, reaction, recommendation
                    from public.skin_records where customer_id = v_cust
                   order by record_date desc, created_at desc limit 1) r)
  );
end $$;
revoke execute on function public.ktv_customer_view(uuid) from public, anon;
grant execute on function public.ktv_customer_view(uuid) to authenticated;

-- Các phần combo khách còn buổi + dịch vụ dùng được (để đặt lịch: hiện trước)
create or replace function public.customer_combo_services(p_customer uuid)
returns table(item_id uuid, package_name text, label text, left_qty int, service_id uuid)
language sql stable security definer set search_path = '' as $$
  select i.id, p.name, i.label, case when i.total_qty is null then null else i.total_qty - i.used_qty end, s.service_id
    from public.customer_package_items i
    join public.customer_packages cp on cp.id = i.customer_package_id
    join public.packages p on p.id = cp.package_id
    join public.customer_package_item_services s on s.item_id = i.id
   where cp.customer_id = p_customer and cp.is_active
     and (cp.expires_at is null or cp.expires_at > now())
     and (i.total_qty is null or i.used_qty < i.total_qty)
     and (select public.is_staff()) and (select public.my_role()::text) <> 'warehouse'
   order by cp.purchased_at, i.sort_order
$$;
revoke execute on function public.customer_combo_services(uuid) from public, anon;
grant execute on function public.customer_combo_services(uuid) to authenticated;

-- KTV đặt lịch cho khách: 1 liệu trình (có thể trừ combo) hoặc hẹn tư vấn (chưa chọn liệu trình)
create or replace function public.ktv_book(
  p_branch_id uuid, p_start_at timestamptz,
  p_customer_id uuid default null, p_customer_name text default null, p_customer_phone text default null,
  p_service_id uuid default null, p_package_item_id uuid default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_role text := public.my_role()::text;
  v_tech boolean := public.my_role()::text = 'technician';
  v_customer uuid := p_customer_id;
  v_phone text := public.normalize_phone(p_customer_phone);
  v_appt uuid;
begin
  if not public.has_role('owner','manager','receptionist','technician') then
    raise exception 'Bạn không có quyền đặt lịch';
  end if;
  if v_tech and p_branch_id is distinct from (select branch_id from public.profiles where id = v_me) then
    raise exception 'KTV chỉ đặt lịch ở chi nhánh của mình';
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
    -- hẹn tư vấn: khách đến mới chọn liệu trình
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
                                     is_consultation, consult_technician_id)
    values (v_customer, p_branch_id, p_start_at, p_start_at + interval '60 minutes', 'confirmed', 'staff',
            nullif(trim(p_note), ''), true, case when v_tech then v_me end)
    returning id into v_appt;
  end if;

  if v_tech then
    update public.appointments set ktv_confirmed_at = now() where id = v_appt;
  end if;
  return v_appt;
end $$;
revoke execute on function public.ktv_book(uuid, timestamptz, uuid, text, text, uuid, uuid, text) from public, anon;
grant execute on function public.ktv_book(uuid, timestamptz, uuid, text, text, uuid, uuid, text) to authenticated;

-- Bắt đầu / Xong bước / Hoàn thành buổi
create or replace function public.ktv_progress(p_aps uuid, p_action text)
returns public.appointment_services language plpgsql security definer set search_path = '' as $$
declare
  v public.appointment_services;
  v_status public.appointment_status;
  v_total int;
begin
  select * into v from public.appointment_services where id = p_aps for update;
  if not found then raise exception 'Không tìm thấy dịch vụ'; end if;
  if v.technician_id is distinct from (select auth.uid()) and not public.has_role('owner','manager') then
    raise exception 'Dịch vụ này không phải của bạn';
  end if;
  select status into v_status from public.appointments where id = v.appointment_id;
  if v_status in ('cancelled','no_show') then raise exception 'Lịch đã huỷ'; end if;
  select count(*) into v_total from public.service_procedure_steps where service_id = v.service_id;

  if p_action = 'start' then
    if v.work_started_at is null then
      update public.appointment_services
         set work_started_at = now(), steps_done = 0, step_log = '[]'::jsonb
       where id = p_aps returning * into v;
      update public.appointments
         set status = case when status in ('pending','confirmed') then 'in_progress'::public.appointment_status else status end,
             ktv_confirmed_at = coalesce(ktv_confirmed_at, now())
       where id = v.appointment_id;
    end if;
  elsif p_action = 'step' then
    if v.work_started_at is null then raise exception 'Bấm Bắt đầu trước'; end if;
    if v.work_done_at is not null then raise exception 'Buổi đã hoàn thành'; end if;
    if v.steps_done >= v_total then raise exception 'Đã xong tất cả các bước'; end if;
    update public.appointment_services
       set steps_done = steps_done + 1,
           step_log = step_log || jsonb_build_array(jsonb_build_object('step', v.steps_done + 1, 'at', now()))
     where id = p_aps returning * into v;
  elsif p_action = 'undo' then
    if v.work_done_at is not null or v.steps_done = 0 then raise exception 'Không có bước để bỏ'; end if;
    update public.appointment_services
       set steps_done = steps_done - 1,
           step_log = coalesce((select jsonb_agg(e) from jsonb_array_elements(step_log) e
                                 where (e->>'step')::int <> v.steps_done), '[]'::jsonb)
     where id = p_aps returning * into v;
  elsif p_action = 'finish' then
    if v.work_started_at is null then raise exception 'Bấm Bắt đầu trước'; end if;
    update public.appointment_services
       set work_done_at = coalesce(work_done_at, now()), steps_done = greatest(steps_done, v_total)
     where id = p_aps returning * into v;
  else
    raise exception 'Thao tác không hợp lệ';
  end if;
  return v;
end $$;
revoke execute on function public.ktv_progress(uuid, text) from public, anon;
grant execute on function public.ktv_progress(uuid, text) to authenticated;

-- KTV xin đổi sản phẩm khác quy trình gốc
create or replace function public.request_procedure_change(p_aps uuid, p_step int, p_from text, p_to text, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.appointment_services
                  where id = p_aps and (technician_id = (select auth.uid()) or public.has_role('owner','manager'))) then
    raise exception 'Dịch vụ này không phải của bạn';
  end if;
  if nullif(trim(p_to), '') is null then raise exception 'Vui lòng ghi sản phẩm muốn dùng'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Vui lòng ghi lý do đổi sản phẩm'; end if;
  insert into public.procedure_change_requests (appointment_service_id, step_no, from_product, to_product, reason, requested_by)
  values (p_aps, p_step, nullif(trim(p_from), ''), trim(p_to), trim(p_reason), (select auth.uid()))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.request_procedure_change(uuid, int, text, text, text) from public, anon;
grant execute on function public.request_procedure_change(uuid, int, text, text, text) to authenticated;

create or replace function public.review_procedure_change(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ chủ spa / quản lý duyệt'; end if;
  update public.procedure_change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = nullif(trim(p_note), '')
   where id = p_id and status = 'pending';
  if not found then raise exception 'Yêu cầu đã được xử lý'; end if;
end $$;
revoke execute on function public.review_procedure_change(uuid, boolean, text) from public, anon;
grant execute on function public.review_procedure_change(uuid, boolean, text) to authenticated;

-- Mô tả lý do ngoài giờ thành 1 dòng (hiện ở bảng chấm công)
create or replace function public._offhours_text(p_kind text, p_appt uuid, p_note text)
returns text language sql stable security definer set search_path = '' as $$
  select nullif(concat_ws(' · ',
    nullif(trim(p_kind), ''),
    (select c.full_name || coalesce(' (' || (select string_agg(sv.name_en, ', ') from public.appointment_services s
                                               join public.services sv on sv.id = s.service_id
                                              where s.appointment_id = a.id) || ')', '')
       from public.appointments a join public.customers c on c.id = a.customer_id where a.id = p_appt),
    nullif(trim(p_note), '')), '')
$$;
revoke execute on function public._offhours_text(text, uuid, text) from public, anon, authenticated;

-- Chấm VÀO: trước 8:30 bắt buộc ghi lý do, gửi quản lý (không tính tăng ca)
create or replace function public.check_in_v2(p_lat double precision default null, p_lng double precision default null,
  p_reason_kind text default null, p_appointment uuid default null, p_note text default null)
returns public.staff_attendance language plpgsql security definer set search_path = '' as $$
declare
  v public.staff_attendance;
  v_early boolean := (now() at time zone 'Asia/Ho_Chi_Minh')::time
                     < coalesce((select (value->>'early_start') from public.app_settings where key = 'payroll'), '08:30')::time;
  v_new boolean;
begin
  v_new := not exists (select 1 from public.staff_attendance where staff_id = (select auth.uid())
                         and work_date = (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  if v_new and v_early and nullif(trim(p_reason_kind), '') is null then
    raise exception 'Bạn chấm vào trước 8:30: vui lòng ghi lý do để quản lý duyệt';
  end if;
  v := public.check_in(p_lat, p_lng);
  if v_new and v_early then
    update public.staff_attendance
       set in_reason_kind = trim(p_reason_kind), in_appointment_id = p_appointment, in_note = nullif(trim(p_note), ''),
           in_status = 'pending'
     where staff_id = v.staff_id and work_date = v.work_date
    returning * into v;
  end if;
  return v;
end $$;
revoke execute on function public.check_in_v2(double precision, double precision, text, uuid, text) from public, anon;
grant execute on function public.check_in_v2(double precision, double precision, text, uuid, text) to authenticated;

-- Chấm RA: sau 18:30 bắt buộc ghi lý do, tăng ca tính từ 18:30 khi được duyệt
create or replace function public.check_out_v2(p_lat double precision default null, p_lng double precision default null,
  p_reason_kind text default null, p_appointment uuid default null, p_note text default null)
returns public.staff_attendance language plpgsql security definer set search_path = '' as $$
declare
  v public.staff_attendance;
  v_late boolean := (now() at time zone 'Asia/Ho_Chi_Minh')::time
                    > coalesce((select (value->>'ot_start') from public.app_settings where key = 'payroll'), '18:30')::time;
begin
  if v_late and nullif(trim(p_reason_kind), '') is null then
    raise exception 'Bạn chấm ra sau 18:30: vui lòng ghi lý do tăng ca để quản lý duyệt';
  end if;
  v := public.check_out(p_lat, p_lng, case when v_late then public._offhours_text(p_reason_kind, p_appointment, p_note) end);
  if v_late then
    update public.staff_attendance
       set ot_reason_kind = trim(p_reason_kind), ot_appointment_id = p_appointment, ot_note = nullif(trim(p_note), '')
     where staff_id = v.staff_id and work_date = v.work_date
    returning * into v;
  end if;
  return v;
end $$;
revoke execute on function public.check_out_v2(double precision, double precision, text, uuid, text) from public, anon;
grant execute on function public.check_out_v2(double precision, double precision, text, uuid, text) to authenticated;

create or replace function public.review_early_checkin(p_staff uuid, p_date date, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ chủ spa / quản lý duyệt'; end if;
  update public.staff_attendance
     set in_status = case when p_approve then 'approved' else 'rejected' end,
         in_reviewed_by = (select auth.uid()), in_reviewed_at = now()
   where staff_id = p_staff and work_date = p_date and in_status = 'pending';
  if not found then raise exception 'Không có lần chấm vào sớm chờ duyệt'; end if;
end $$;
revoke execute on function public.review_early_checkin(uuid, date, boolean) from public, anon;
grant execute on function public.review_early_checkin(uuid, date, boolean) to authenticated;
