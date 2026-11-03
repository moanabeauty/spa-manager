-- Chấm công: kiểm tra vị trí + chủ spa duyệt
-- 1. Check-in / out gửi kèm vị trí điện thoại; cách chi nhánh gần nhất quá 100m (hoặc không lấy được vị trí) -> chờ chủ spa duyệt
-- 2. Quản lý sửa / bổ sung giờ (quên check-in, quên check-out) -> chờ chủ spa duyệt; chủ spa sửa thì duyệt luôn
-- 3. Chỉ ngày "hợp lệ" hoặc "đã duyệt" mới được tính công
-- 4. Tăng ca: phải check-out từ 18:30 trở đi mới tính, tính từ 18:00 theo từng nửa tiếng (19:10 -> 1 giờ)

alter table public.branches
  add column latitude double precision check (latitude between -90 and 90),
  add column longitude double precision check (longitude between -180 and 180);

update public.app_settings set value = value || jsonb_build_object('geo_radius_m', 100, 'ot_start', '18:30')
 where key = 'payroll';

alter table public.staff_attendance
  add column in_lat double precision, add column in_lng double precision, add column in_distance_m int,
  add column out_lat double precision, add column out_lng double precision, add column out_distance_m int,
  add column approval_status text not null default 'ok' check (approval_status in ('ok','pending','approved','rejected')),
  add column approval_reason text,
  add column approved_by uuid references public.profiles(id),
  add column approved_at timestamptz;
create index on public.staff_attendance (approval_status) where approval_status = 'pending';
create index on public.staff_attendance (approved_by);

-- chủ spa lưu vị trí chi nhánh (bấm khi đang đứng ở chi nhánh)
create or replace function public.set_branch_location(p_branch uuid, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa đặt được vị trí chi nhánh'; end if;
  update public.branches set latitude = p_lat, longitude = p_lng where id = p_branch;
end $$;
revoke execute on function public.set_branch_location(uuid, double precision, double precision) from public, anon;
grant execute on function public.set_branch_location(uuid, double precision, double precision) to authenticated;

-- chi nhánh gần nhất + khoảng cách (mét)
create or replace function public._nearest_branch(p_lat double precision, p_lng double precision)
returns table (branch_id uuid, distance_m int)
language sql stable security definer set search_path = '' as $$
  select b.id,
         round(2 * 6371000 * asin(sqrt(
           power(sin(radians(b.latitude - p_lat) / 2), 2)
           + cos(radians(p_lat)) * cos(radians(b.latitude)) * power(sin(radians(b.longitude - p_lng) / 2), 2))))::int
    from public.branches b
   where b.latitude is not null and b.longitude is not null and b.is_active
   order by 2 limit 1
$$;
revoke execute on function public._nearest_branch(double precision, double precision) from public, anon, authenticated;

drop function if exists public.check_in();
drop function if exists public.check_out();

create or replace function public.check_in(p_lat double precision default null, p_lng double precision default null)
returns public.staff_attendance language plpgsql security definer set search_path = '' as $$
declare
  v public.staff_attendance;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_radius int := coalesce((select (value->>'geo_radius_m')::int from public.app_settings where key = 'payroll'), 100);
  v_geo_on boolean := exists (select 1 from public.branches where latitude is not null and is_active);
  v_bid uuid;
  v_dist int;
  v_status text := 'ok';
  v_reason text;
begin
  if not public.has_role('manager','receptionist','technician','warehouse','owner') then raise exception 'Chỉ nhân viên'; end if;
  select * into v from public.staff_attendance where staff_id = (select auth.uid()) and work_date = v_today;
  if found then return v; end if;
  if v_geo_on then
    if p_lat is null or p_lng is null then
      v_status := 'pending'; v_reason := 'Check-in không lấy được vị trí';
    else
      select n.branch_id, n.distance_m into v_bid, v_dist from public._nearest_branch(p_lat, p_lng) n;
      if v_dist > v_radius then
        v_status := 'pending'; v_reason := 'Check-in cách chi nhánh ' || v_dist || 'm';
      end if;
    end if;
  end if;
  insert into public.staff_attendance (staff_id, work_date, branch_id, check_in, in_lat, in_lng, in_distance_m, approval_status, approval_reason)
  values ((select auth.uid()), v_today,
          coalesce(case when v_dist <= v_radius then v_bid end,
                   (select branch_id from public.profiles where id = (select auth.uid()))),
          now(), p_lat, p_lng, v_dist, v_status, v_reason)
  returning * into v;
  return v;
end $$;
revoke execute on function public.check_in(double precision, double precision) from public, anon;
grant execute on function public.check_in(double precision, double precision) to authenticated;

create or replace function public.check_out(p_lat double precision default null, p_lng double precision default null)
returns public.staff_attendance language plpgsql security definer set search_path = '' as $$
declare
  v public.staff_attendance;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_radius int := coalesce((select (value->>'geo_radius_m')::int from public.app_settings where key = 'payroll'), 100);
  v_geo_on boolean := exists (select 1 from public.branches where latitude is not null and is_active);
  v_bid uuid;
  v_dist int;
  v_reason text;
begin
  select * into v from public.staff_attendance where staff_id = (select auth.uid()) and work_date = v_today for update;
  if not found then raise exception 'Hôm nay bạn chưa check-in'; end if;
  if v_geo_on then
    if p_lat is null or p_lng is null then
      v_reason := 'Check-out không lấy được vị trí';
    else
      select n.branch_id, n.distance_m into v_bid, v_dist from public._nearest_branch(p_lat, p_lng) n;
      if v_dist > v_radius then v_reason := 'Check-out cách chi nhánh ' || v_dist || 'm'; end if;
    end if;
  end if;
  update public.staff_attendance
     set check_out = now(), out_lat = p_lat, out_lng = p_lng, out_distance_m = v_dist,
         approval_status = case when v_reason is not null and approval_status in ('ok','approved') then 'pending' else approval_status end,
         approval_reason = case when v_reason is null then approval_reason
                                else concat_ws(' · ', nullif(approval_reason, ''), v_reason) end,
         approved_by = case when v_reason is not null then null else approved_by end,
         approved_at = case when v_reason is not null then null else approved_at end
   where staff_id = (select auth.uid()) and work_date = v_today
  returning * into v;
  return v;
end $$;
revoke execute on function public.check_out(double precision, double precision) from public, anon;
grant execute on function public.check_out(double precision, double precision) to authenticated;

-- quản lý sửa / bổ sung -> chờ chủ duyệt; chủ sửa -> duyệt luôn
create or replace function public.save_attendance(p_staff uuid, p_date date, p_in timestamptz, p_out timestamptz, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_owner boolean := public.has_role('owner');
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ quản lý / chủ spa sửa được chấm công'; end if;
  if p_in is null then
    delete from public.staff_attendance where staff_id = p_staff and work_date = p_date;
    return;
  end if;
  if p_out is not null and p_out <= p_in then raise exception 'Giờ check-out phải sau giờ check-in'; end if;
  if not v_owner and nullif(trim(p_note), '') is null then raise exception 'Vui lòng ghi lý do sửa (vd quên check-out)'; end if;
  insert into public.staff_attendance (staff_id, work_date, branch_id, check_in, check_out, note, edited_by, edited_at,
                                       approval_status, approval_reason, approved_by, approved_at)
  values (p_staff, p_date, (select branch_id from public.profiles where id = p_staff), p_in, p_out, nullif(trim(p_note), ''),
          (select auth.uid()), now(),
          case when v_owner then 'approved' else 'pending' end,
          case when v_owner then null else 'Quản lý sửa / bổ sung giờ' end,
          case when v_owner then (select auth.uid()) end, case when v_owner then now() end)
  on conflict (staff_id, work_date) do update
    set check_in = excluded.check_in, check_out = excluded.check_out, note = excluded.note,
        edited_by = excluded.edited_by, edited_at = now(),
        approval_status = excluded.approval_status,
        approval_reason = case when v_owner then public.staff_attendance.approval_reason
                               else concat_ws(' · ', nullif(public.staff_attendance.approval_reason, ''), 'Quản lý sửa / bổ sung giờ') end,
        approved_by = excluded.approved_by, approved_at = excluded.approved_at;
end $$;

create or replace function public.review_attendance(p_staff uuid, p_date date, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa duyệt chấm công'; end if;
  update public.staff_attendance
     set approval_status = case when p_approve then 'approved' else 'rejected' end,
         approved_by = (select auth.uid()), approved_at = now()
   where staff_id = p_staff and work_date = p_date;
  if not found then raise exception 'Không tìm thấy ngày công'; end if;
end $$;
revoke execute on function public.review_attendance(uuid, date, boolean) from public, anon;
grant execute on function public.review_attendance(uuid, date, boolean) to authenticated;

-- công + giờ thêm từng ngày: chỉ tính ngày hợp lệ / đã duyệt
create or replace function public._attendance_days(p_from date, p_to date)
returns table (staff_id uuid, work_date date, check_in timestamptz, check_out timestamptz, net_hours numeric, days numeric, ot_hours numeric)
language sql stable security definer set search_path = '' as $$
  with cfg as (
    select coalesce((value->>'shift_end'), '18:00')::time as se,
           coalesce((value->>'ot_start'), '18:30')::time as ots,
           coalesce((value->>'lunch_minutes')::numeric, 60) as lunch,
           coalesce((value->>'full_day_hours')::numeric, 6) as full_h,
           coalesce((value->>'half_day_hours')::numeric, 3) as half_h
      from public.app_settings where key = 'payroll'
  ), x as (
    select a.staff_id, a.work_date, a.check_in, a.check_out,
           a.approval_status in ('ok','approved') as counted,
           (a.check_in at time zone 'Asia/Ho_Chi_Minh')::time as ti,
           (a.check_out at time zone 'Asia/Ho_Chi_Minh')::time as tout
      from public.staff_attendance a
     where a.work_date between p_from and p_to
  ), h as (
    select x.*, cfg.*,
           case when x.check_out is null then 0
                else greatest(0, extract(epoch from x.check_out - x.check_in) / 3600
                     - case when x.ti <= '12:00' and x.tout >= '13:00' then cfg.lunch / 60 else 0 end) end as net
      from x cross join cfg
  )
  select h.staff_id, h.work_date, h.check_in, h.check_out, round(h.net::numeric, 2),
         case when not h.counted or h.check_out is null then 0
              when h.net >= h.full_h then 1 when h.net >= h.half_h then 0.5 else 0 end,
         case when not h.counted or h.check_out is null or h.tout < h.ots then 0
              else floor(extract(epoch from h.tout - h.se) / 1800) / 2 end
    from h
$$;
revoke execute on function public._attendance_days(date, date) from public, anon, authenticated;

drop function if exists public.attendance_month(date);
drop function if exists public._attendance_month(date);
create function public._attendance_month(p_month date)
returns table (staff_id uuid, days numeric, ot_hours numeric, records bigint, missing_out bigint, pending bigint)
language sql stable security definer set search_path = '' as $$
  select d.staff_id, sum(d.days), sum(d.ot_hours), count(*), count(*) filter (where d.check_out is null),
         count(*) filter (where a.approval_status = 'pending')
    from public._attendance_days(date_trunc('month', p_month)::date,
                                 (date_trunc('month', p_month) + interval '1 month - 1 day')::date) d
    join public.staff_attendance a on a.staff_id = d.staff_id and a.work_date = d.work_date
   group by 1
$$;
revoke execute on function public._attendance_month(date) from public, anon, authenticated;

create function public.attendance_month(p_month date)
returns table (staff_id uuid, days numeric, ot_hours numeric, records bigint, missing_out bigint, pending bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ quản lý / chủ spa'; end if;
  return query select * from public._attendance_month(p_month);
end $$;
revoke execute on function public.attendance_month(date) from public, anon;
grant execute on function public.attendance_month(date) to authenticated;

drop function if exists public.attendance_report(date);
create function public.attendance_report(p_month date)
returns table (staff_id uuid, work_date date, check_in timestamptz, check_out timestamptz, net_hours numeric, days numeric,
               ot_hours numeric, note text, edited boolean, approval_status text, approval_reason text,
               in_distance_m int, out_distance_m int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Chỉ nhân viên'; end if;
  return query
  select d.staff_id, d.work_date, d.check_in, d.check_out, d.net_hours, d.days, d.ot_hours, a.note, a.edited_by is not null,
         a.approval_status, a.approval_reason, a.in_distance_m, a.out_distance_m
    from public._attendance_days(date_trunc('month', p_month)::date,
                                 (date_trunc('month', p_month) + interval '1 month - 1 day')::date) d
    join public.staff_attendance a on a.staff_id = d.staff_id and a.work_date = d.work_date
   where public.has_role('owner','manager') or d.staff_id = (select auth.uid())
   order by d.work_date desc, d.staff_id;
end $$;
revoke execute on function public.attendance_report(date) from public, anon;
grant execute on function public.attendance_report(date) to authenticated;

-- cài đặt: thêm bán kính + giờ bắt đầu tính tăng ca
create or replace function public.set_payroll_settings(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa được đổi cài đặt lương'; end if;
  foreach k in array array['standard_days','hours_per_day','overtime_rate','meal_per_day','bhxh_employee_pct','bhxh_employer_pct',
                           'lunch_minutes','full_day_hours','half_day_hours','geo_radius_m'] loop
    if p ? k and ((p->>k)::numeric < 0 or (k in ('standard_days','hours_per_day','geo_radius_m') and (p->>k)::numeric <= 0)) then
      raise exception 'Giá trị % không hợp lệ', k;
    end if;
  end loop;
  foreach k in array array['shift_start','shift_end','ot_start'] loop
    if p ? k and (p->>k) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Giờ % không hợp lệ (vd 09:00)', k; end if;
  end loop;
  update public.app_settings
     set value = value
       || coalesce((select jsonb_object_agg(e.k, to_jsonb((e.v #>> '{}')::numeric)) from jsonb_each(p) e(k, v)
                     where e.k in ('standard_days','hours_per_day','overtime_rate','meal_per_day','bhxh_employee_pct','bhxh_employer_pct',
                                   'lunch_minutes','full_day_hours','half_day_hours','geo_radius_m')), '{}'::jsonb)
       || coalesce((select jsonb_object_agg(e.k, e.v) from jsonb_each(p) e(k, v) where e.k in ('shift_start','shift_end','ot_start')), '{}'::jsonb),
         updated_by = (select auth.uid()), updated_at = now()
   where key = 'payroll';
end $$;
