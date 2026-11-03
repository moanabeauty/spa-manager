-- Lương theo giờ + duyệt tăng ca + nghỉ phép
-- 1. 1 tháng chuẩn 27 công = 243 giờ (9:00 – 18:00 = 9 giờ / ngày). Giờ làm = thời gian có mặt trong khung 9:00 – 18:00
--    (đến trước 9:00 / về sau 18:00 không tính thêm). Lương cơ bản = lương × giờ làm / 243.
--    Phụ cấp ăn tính theo số ngày đi làm (ngày có check-in + check-out hợp lệ).
-- 2. Tăng ca: check-out từ 18:30, nhân viên ghi lý do (vd làm cho khách nào) -> quản lý / chủ duyệt số giờ mới được tính.
--    Đơn giá giờ tăng ca = lương ÷ 27 ÷ 8 × 150%.
-- 3. Nghỉ phép: nhân viên đăng ký (có lương / không lương) -> quản lý / chủ duyệt. Phép có lương được cộng 9 giờ / ngày.
--    Nghỉ không phép (quản lý ghi): không có lương ngày đó + trừ thêm 1 ngày lương (lương ÷ 27).

update public.app_settings
   set value = value || jsonb_build_object('hours_per_day', 9, 'ot_hours_per_day', 8)
 where key = 'payroll';

alter table public.payroll_entries add column work_hours numeric(6,2) check (work_hours >= 0);
alter table public.payroll_entries alter column work_days drop not null, alter column work_days drop default;
alter table public.payroll_entries alter column overtime_hours drop not null, alter column overtime_hours drop default;

-- ============ TĂNG CA ============
alter table public.staff_attendance
  add column ot_reason text,
  add column ot_status text not null default 'none' check (ot_status in ('none','pending','approved','rejected')),
  add column ot_hours_approved numeric(5,2) check (ot_hours_approved >= 0),
  add column ot_reviewed_by uuid references public.profiles(id),
  add column ot_reviewed_at timestamptz;
create index on public.staff_attendance (ot_status) where ot_status = 'pending';
create index on public.staff_attendance (ot_reviewed_by);

-- số giờ tăng ca theo giờ check-out (chưa duyệt)
create or replace function public._ot_hours(p_out timestamptz)
returns numeric language sql stable security definer set search_path = '' as $$
  select case when p_out is null then 0
              when (p_out at time zone 'Asia/Ho_Chi_Minh')::time < coalesce((value->>'ot_start'), '18:30')::time then 0
              else floor(extract(epoch from (p_out at time zone 'Asia/Ho_Chi_Minh')::time
                                            - coalesce((value->>'shift_end'), '18:00')::time) / 1800) / 2 end
    from public.app_settings where key = 'payroll'
$$;
revoke execute on function public._ot_hours(timestamptz) from public, anon, authenticated;

-- sau mỗi lần đổi giờ check-out: có giờ tăng ca thì chuyển "chờ duyệt", hết thì về "không"
create or replace function public.staff_attendance_ot()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v numeric;
begin
  if tg_op = 'UPDATE' then
    if new.check_out is not distinct from old.check_out then return new; end if;
  end if;
  v := public._ot_hours(new.check_out);
  if v > 0 then
    new.ot_status := 'pending'; new.ot_hours_approved := null;
  else
    new.ot_status := 'none'; new.ot_hours_approved := null;
  end if;
  return new;
end $$;
revoke execute on function public.staff_attendance_ot() from public, anon, authenticated;
create trigger staff_attendance_ot_biu before insert or update on public.staff_attendance
for each row execute function public.staff_attendance_ot();

drop function if exists public.check_out(double precision, double precision);
create or replace function public.check_out(p_lat double precision default null, p_lng double precision default null,
                                            p_ot_reason text default null)
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
  if public._ot_hours(now()) > 0 and nullif(trim(p_ot_reason), '') is null then
    raise exception 'Bạn check-out sau giờ tăng ca: vui lòng ghi lý do tăng ca (vd làm cho khách nào)';
  end if;
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
         ot_reason = coalesce(nullif(trim(p_ot_reason), ''), ot_reason),
         ot_status = case when ot_status = 'approved' then 'pending' else ot_status end,
         ot_hours_approved = null,
         approval_status = case when v_reason is not null and approval_status in ('ok','approved') then 'pending' else approval_status end,
         approval_reason = case when v_reason is null then approval_reason
                                else concat_ws(' · ', nullif(approval_reason, ''), v_reason) end,
         approved_by = case when v_reason is not null then null else approved_by end,
         approved_at = case when v_reason is not null then null else approved_at end
   where staff_id = (select auth.uid()) and work_date = v_today
  returning * into v;
  return v;
end $$;
revoke execute on function public.check_out(double precision, double precision, text) from public, anon;
grant execute on function public.check_out(double precision, double precision, text) to authenticated;

-- nhân viên ghi / sửa lý do tăng ca (trong tháng, ngày của mình)
create or replace function public.set_overtime_reason(p_date date, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if nullif(trim(p_reason), '') is null then raise exception 'Vui lòng ghi lý do tăng ca'; end if;
  update public.staff_attendance set ot_reason = trim(p_reason)
   where staff_id = (select auth.uid()) and work_date = p_date and ot_status = 'pending';
  if not found then raise exception 'Ngày này không có giờ tăng ca chờ duyệt'; end if;
end $$;
revoke execute on function public.set_overtime_reason(date, text) from public, anon;
grant execute on function public.set_overtime_reason(date, text) to authenticated;

-- quản lý / chủ duyệt tăng ca (được duyệt ít giờ hơn)
create or replace function public.review_overtime(p_staff uuid, p_date date, p_approve boolean, p_hours numeric default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v record; v_max numeric;
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ quản lý / chủ spa duyệt tăng ca'; end if;
  select * into v from public.staff_attendance where staff_id = p_staff and work_date = p_date for update;
  if not found then raise exception 'Không tìm thấy ngày công'; end if;
  v_max := public._ot_hours(v.check_out);
  if v_max <= 0 then raise exception 'Ngày này không có giờ tăng ca'; end if;
  if p_approve and p_hours is not null and (p_hours <= 0 or p_hours > v_max) then
    raise exception 'Số giờ duyệt phải từ 0,5 đến % giờ', v_max;
  end if;
  update public.staff_attendance
     set ot_status = case when p_approve then 'approved' else 'rejected' end,
         ot_hours_approved = case when p_approve then coalesce(p_hours, v_max) end,
         ot_reviewed_by = (select auth.uid()), ot_reviewed_at = now()
   where staff_id = p_staff and work_date = p_date;
end $$;
revoke execute on function public.review_overtime(uuid, date, boolean, numeric) from public, anon;
grant execute on function public.review_overtime(uuid, date, boolean, numeric) to authenticated;

-- ============ NGHỈ PHÉP ============
create table public.staff_leaves (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id) on delete cascade,
  leave_date date not null,
  kind text not null check (kind in ('paid','unpaid','unexcused')),  -- có lương / không lương / không phép
  half_day boolean not null default false,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  requested_by uuid references public.profiles(id) default auth.uid(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create unique index staff_leaves_one_per_day on public.staff_leaves (staff_id, leave_date) where status in ('pending','approved');
create index on public.staff_leaves (leave_date);
create index on public.staff_leaves (status) where status = 'pending';
create index on public.staff_leaves (requested_by);
create index on public.staff_leaves (reviewed_by);
alter table public.staff_leaves enable row level security;
create policy "own or management read" on public.staff_leaves for select to authenticated
  using (staff_id = (select auth.uid()) or (select public.has_role('owner','manager')));

-- nhân viên đăng ký nghỉ (1 hoặc nhiều ngày liền)
create or replace function public.request_leave(p_from date, p_to date, p_kind text, p_reason text, p_half_day boolean default false)
returns int language plpgsql security definer set search_path = '' as $$
declare d date; n int := 0;
begin
  if not public.is_staff() then raise exception 'Chỉ nhân viên'; end if;
  if p_kind not in ('paid','unpaid') then raise exception 'Loại nghỉ không hợp lệ'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Vui lòng ghi lý do nghỉ'; end if;
  p_to := coalesce(p_to, p_from);
  if p_to < p_from or p_to - p_from > 30 then raise exception 'Khoảng ngày nghỉ không hợp lệ (tối đa 31 ngày)'; end if;
  if p_half_day and p_to <> p_from then raise exception 'Nghỉ nửa ngày chỉ chọn 1 ngày'; end if;
  for d in select generate_series(p_from, p_to, interval '1 day')::date loop
    if exists (select 1 from public.staff_leaves where staff_id = (select auth.uid()) and leave_date = d and status in ('pending','approved')) then
      raise exception 'Ngày % đã có đơn nghỉ', to_char(d, 'DD/MM');
    end if;
    insert into public.staff_leaves (staff_id, leave_date, kind, half_day, reason)
    values ((select auth.uid()), d, p_kind, coalesce(p_half_day, false), trim(p_reason));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.request_leave(date, date, text, text, boolean) from public, anon;
grant execute on function public.request_leave(date, date, text, text, boolean) to authenticated;

create or replace function public.cancel_leave(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.staff_leaves set status = 'cancelled'
   where id = p_id and status = 'pending' and staff_id = (select auth.uid());
  if not found then raise exception 'Chỉ huỷ được đơn của mình đang chờ duyệt'; end if;
end $$;
revoke execute on function public.cancel_leave(uuid) from public, anon;
grant execute on function public.cancel_leave(uuid) to authenticated;

create or replace function public.review_leave(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ quản lý / chủ spa duyệt nghỉ phép'; end if;
  update public.staff_leaves
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = nullif(trim(p_note), '')
   where id = p_id and status = 'pending';
  if not found then raise exception 'Đơn không còn chờ duyệt'; end if;
end $$;
revoke execute on function public.review_leave(uuid, boolean, text) from public, anon;
grant execute on function public.review_leave(uuid, boolean, text) to authenticated;

-- quản lý ghi nghỉ không phép (bị trừ thêm 1 ngày lương)
create or replace function public.record_absence(p_staff uuid, p_date date, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ quản lý / chủ spa ghi nghỉ không phép'; end if;
  if exists (select 1 from public.staff_attendance where staff_id = p_staff and work_date = p_date
              and approval_status in ('ok','approved','pending')) then
    raise exception 'Ngày này nhân viên có check-in, hãy xoá ngày công trước';
  end if;
  update public.staff_leaves set status = 'rejected', reviewed_by = (select auth.uid()), reviewed_at = now(),
         review_note = 'Chuyển thành nghỉ không phép'
   where staff_id = p_staff and leave_date = p_date and status in ('pending','approved');
  insert into public.staff_leaves (staff_id, leave_date, kind, reason, status, reviewed_by, reviewed_at)
  values (p_staff, p_date, 'unexcused', nullif(trim(p_reason), ''), 'approved', (select auth.uid()), now());
end $$;
revoke execute on function public.record_absence(uuid, date, text) from public, anon;
grant execute on function public.record_absence(uuid, date, text) to authenticated;

create or replace function public.delete_absence(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ quản lý / chủ spa'; end if;
  update public.staff_leaves set status = 'cancelled', reviewed_by = (select auth.uid()), reviewed_at = now()
   where id = p_id and kind = 'unexcused';
end $$;
revoke execute on function public.delete_absence(uuid) from public, anon;
grant execute on function public.delete_absence(uuid) to authenticated;

-- ============ TÍNH GIỜ / CÔNG ============
drop function if exists public.attendance_report(date);
drop function if exists public.attendance_month(date);
drop function if exists public._attendance_month(date);
drop function if exists public._attendance_days(date, date);

-- từng ngày: giờ làm trong khung ca, có tính ngày đi làm không, giờ tăng ca (theo giờ về / đã duyệt)
create function public._attendance_days(p_from date, p_to date)
returns table (staff_id uuid, work_date date, check_in timestamptz, check_out timestamptz, work_hours numeric,
               days numeric, ot_hours numeric, ot_hours_approved numeric)
language sql stable security definer set search_path = '' as $$
  with cfg as (
    select coalesce((value->>'shift_start'), '09:00')::time as ss,
           coalesce((value->>'shift_end'), '18:00')::time as se
      from public.app_settings where key = 'payroll'
  )
  select a.staff_id, a.work_date, a.check_in, a.check_out,
         case when a.approval_status not in ('ok','approved') or a.check_out is null then 0
              else round(greatest(0, extract(epoch from
                     least(a.check_out, (a.work_date + cfg.se) at time zone 'Asia/Ho_Chi_Minh')
                     - greatest(a.check_in, (a.work_date + cfg.ss) at time zone 'Asia/Ho_Chi_Minh')) / 3600)::numeric, 2) end,
         case when a.approval_status not in ('ok','approved') or a.check_out is null then 0 else 1 end,
         public._ot_hours(a.check_out),
         case when a.approval_status in ('ok','approved') and a.ot_status = 'approved' then coalesce(a.ot_hours_approved, 0) else 0 end
    from public.staff_attendance a cross join cfg
   where a.work_date between p_from and p_to
$$;
revoke execute on function public._attendance_days(date, date) from public, anon, authenticated;

create function public._attendance_month(p_month date)
returns table (staff_id uuid, work_hours numeric, days numeric, ot_hours numeric, records bigint, missing_out bigint,
               pending bigint, ot_pending bigint, paid_leave_days numeric, unpaid_leave_days numeric, absences bigint)
language sql stable security definer set search_path = '' as $$
  with m as (select date_trunc('month', p_month)::date as f,
                    (date_trunc('month', p_month) + interval '1 month - 1 day')::date as t),
  att as (
    select d.staff_id, sum(d.work_hours) wh, sum(d.days) dd, sum(d.ot_hours_approved) ot, count(*) n,
           count(*) filter (where d.check_out is null) mo,
           count(*) filter (where a.approval_status = 'pending') pe,
           count(*) filter (where a.ot_status = 'pending') ope
      from m, public._attendance_days(m.f, m.t) d
      join public.staff_attendance a on a.staff_id = d.staff_id and a.work_date = d.work_date
     group by 1
  ), lv as (
    select l.staff_id,
           sum(case when l.half_day then 0.5 else 1 end) filter (where l.kind = 'paid') pl,
           sum(case when l.half_day then 0.5 else 1 end) filter (where l.kind = 'unpaid') ul,
           count(*) filter (where l.kind = 'unexcused') ab
      from m, public.staff_leaves l
     where l.status = 'approved' and l.leave_date between m.f and m.t
     group by 1
  )
  select coalesce(att.staff_id, lv.staff_id), coalesce(att.wh, 0), coalesce(att.dd, 0), coalesce(att.ot, 0),
         coalesce(att.n, 0), coalesce(att.mo, 0), coalesce(att.pe, 0), coalesce(att.ope, 0),
         coalesce(lv.pl, 0), coalesce(lv.ul, 0), coalesce(lv.ab, 0)
    from att full join lv on lv.staff_id = att.staff_id
$$;
revoke execute on function public._attendance_month(date) from public, anon, authenticated;

create function public.attendance_month(p_month date)
returns table (staff_id uuid, work_hours numeric, days numeric, ot_hours numeric, records bigint, missing_out bigint,
               pending bigint, ot_pending bigint, paid_leave_days numeric, unpaid_leave_days numeric, absences bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ quản lý / chủ spa'; end if;
  return query select * from public._attendance_month(p_month);
end $$;
revoke execute on function public.attendance_month(date) from public, anon;
grant execute on function public.attendance_month(date) to authenticated;

create function public.attendance_report(p_month date)
returns table (staff_id uuid, work_date date, check_in timestamptz, check_out timestamptz, work_hours numeric, days numeric,
               ot_hours numeric, ot_hours_approved numeric, ot_status text, ot_reason text, note text, edited boolean,
               approval_status text, approval_reason text, in_distance_m int, out_distance_m int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Chỉ nhân viên'; end if;
  return query
  select d.staff_id, d.work_date, d.check_in, d.check_out, d.work_hours, d.days, d.ot_hours, a.ot_hours_approved,
         a.ot_status, a.ot_reason, a.note, a.edited_by is not null,
         a.approval_status, a.approval_reason, a.in_distance_m, a.out_distance_m
    from public._attendance_days(date_trunc('month', p_month)::date,
                                 (date_trunc('month', p_month) + interval '1 month - 1 day')::date) d
    join public.staff_attendance a on a.staff_id = d.staff_id and a.work_date = d.work_date
   where public.has_role('owner','manager') or d.staff_id = (select auth.uid())
   order by d.work_date desc, d.staff_id;
end $$;
revoke execute on function public.attendance_report(date) from public, anon;
grant execute on function public.attendance_report(date) to authenticated;

-- ============ BẢNG LƯƠNG ============
drop function if exists public._payroll_rows(date);
create function public._payroll_rows(p_month date)
returns table (staff_id uuid, full_name text, role text, branch_id uuid, has_entry boolean,
               base_salary numeric, standard_days numeric, standard_hours numeric, work_hours numeric, paid_leave_days numeric,
               work_days numeric, base_pay numeric,
               responsibility_pay numeric, meal_allowance numeric, overtime_hours numeric, overtime_pay numeric,
               sales_amount numeric, commission_rate numeric, commission numeric, services_done bigint, service_fee numeric,
               other_allowance numeric, gross_pay numeric, penalties numeric, penalty_count bigint,
               absences bigint, absence_deduction numeric,
               insurance_salary numeric, insurance_employee numeric, other_deduction numeric, net_pay numeric,
               insurance_employer numeric, note text)
language sql stable security definer set search_path = '' as $$
  with cfg as (
    select (value->>'standard_days')::numeric sd, coalesce((value->>'hours_per_day')::numeric, 9) hpd,
           coalesce((value->>'ot_hours_per_day')::numeric, 8) othpd,
           (value->>'overtime_rate')::numeric otr, (value->>'meal_per_day')::numeric meal,
           (value->>'bhxh_employee_pct')::numeric ee, (value->>'bhxh_employer_pct')::numeric er
      from public.app_settings where key = 'payroll'
  ), m as (select date_trunc('month', p_month)::date as m),
  com as (select c.staff_id, c.sales_amount, c.rate, c.commission_amount from public.staff_monthly_commissions c, m where c.month = m.m),
  fee as (select f.technician_id as staff_id, f.services_done, f.fee_amount from public.technician_monthly_fees f, m where f.month = m.m),
  pen as (select p.staff_id, sum(p.amount) amt, count(*) n from public.staff_penalties p, m
           where p.penalty_date >= m.m and p.penalty_date < (m.m + interval '1 month') group by 1),
  ent as (select e.* from public.payroll_entries e, m where e.month = m.m),
  att as (select * from public._attendance_month(p_month)),
  base as (
    select p.id, p.full_name, p.role::text as role, p.branch_id,
           s.base_salary, s.responsibility_pay, s.insurance_salary, s.meal_per_day, s.standard_days as own_sd,
           (e.staff_id is not null or a.staff_id is not null) as has_entry,
           coalesce(a.paid_leave_days, 0) pld,
           coalesce(e.work_hours, coalesce(a.work_hours, 0) + coalesce(a.paid_leave_days, 0) * cfg.hpd) wh,
           coalesce(e.work_days, a.days, 0) wd, coalesce(e.overtime_hours, a.ot_hours, 0) ot,
           coalesce(a.absences, 0) ab,
           coalesce(e.other_allowance, 0) oa, coalesce(e.other_deduction, 0) od, e.note,
           coalesce(c.sales_amount, 0) sales, coalesce(c.rate, 0) rate, coalesce(c.commission_amount, 0) comm,
           coalesce(f.services_done, 0) done, coalesce(f.fee_amount, 0) fee,
           coalesce(pe.amt, 0) pen, coalesce(pe.n, 0) pen_n
      from public.profiles p
      cross join cfg
      left join public.staff_pay_settings s on s.staff_id = p.id
      left join ent e on e.staff_id = p.id
      left join com c on c.staff_id = p.id
      left join fee f on f.staff_id = p.id
      left join pen pe on pe.staff_id = p.id
      left join att a on a.staff_id = p.id
     where p.role <> 'customer'
       and coalesce(s.on_payroll, true)
       and ((p.is_active and p.role <> 'owner') or s.staff_id is not null or e.staff_id is not null
            or c.staff_id is not null or f.staff_id is not null or pe.staff_id is not null or a.staff_id is not null)
  ), calc as (
    select b.*, cfg.hpd, cfg.othpd, cfg.otr, cfg.meal, cfg.ee, cfg.er,
           coalesce(b.own_sd, cfg.sd) as sd, coalesce(b.own_sd, cfg.sd) * cfg.hpd as sh,
           round(coalesce(b.base_salary, 0) * b.wh / (coalesce(b.own_sd, cfg.sd) * cfg.hpd)) as base_pay,
           round(b.wd * coalesce(b.meal_per_day, cfg.meal)) as meal_pay,
           round(coalesce(b.base_salary, 0) / coalesce(b.own_sd, cfg.sd) / cfg.othpd * b.ot * cfg.otr) as ot_pay,
           round(coalesce(b.base_salary, 0) / coalesce(b.own_sd, cfg.sd)) * b.ab as ab_ded,
           round(coalesce(b.insurance_salary, 0) * cfg.ee / 100) as ins_ee,
           round(coalesce(b.insurance_salary, 0) * cfg.er / 100) as ins_er
      from base b cross join cfg
  )
  select c.id, c.full_name, c.role, c.branch_id, c.has_entry,
         coalesce(c.base_salary, 0), c.sd, c.sh, c.wh, c.pld, c.wd, c.base_pay,
         coalesce(c.responsibility_pay, 0), c.meal_pay, c.ot, c.ot_pay,
         c.sales, c.rate, c.comm, c.done::bigint, c.fee, c.oa,
         c.base_pay + coalesce(c.responsibility_pay, 0) + c.meal_pay + c.ot_pay + c.comm + c.fee + c.oa,
         c.pen, c.pen_n::bigint, c.ab::bigint, c.ab_ded,
         coalesce(c.insurance_salary, 0), c.ins_ee, c.od,
         c.base_pay + coalesce(c.responsibility_pay, 0) + c.meal_pay + c.ot_pay + c.comm + c.fee + c.oa
           - c.pen - c.ab_ded - c.ins_ee - c.od,
         c.ins_er, c.note
    from calc c
   order by case c.role when 'manager' then 0 when 'receptionist' then 1 when 'technician' then 2 else 3 end, c.full_name
$$;
revoke execute on function public._payroll_rows(date) from public, anon, authenticated;

-- cài đặt: thêm số giờ / ngày tính tăng ca
create or replace function public.set_payroll_settings(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare k text;
  nums text[] := array['standard_days','hours_per_day','ot_hours_per_day','overtime_rate','meal_per_day','bhxh_employee_pct',
                       'bhxh_employer_pct','geo_radius_m'];
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa được đổi cài đặt lương'; end if;
  foreach k in array nums loop
    if p ? k and ((p->>k)::numeric < 0 or (k in ('standard_days','hours_per_day','ot_hours_per_day','geo_radius_m') and (p->>k)::numeric <= 0)) then
      raise exception 'Giá trị % không hợp lệ', k;
    end if;
  end loop;
  foreach k in array array['shift_start','shift_end','ot_start'] loop
    if p ? k and (p->>k) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Giờ % không hợp lệ (vd 09:00)', k; end if;
  end loop;
  update public.app_settings
     set value = value
       || coalesce((select jsonb_object_agg(e.k, to_jsonb((e.v #>> '{}')::numeric)) from jsonb_each(p) e(k, v) where e.k = any(nums)), '{}'::jsonb)
       || coalesce((select jsonb_object_agg(e.k, e.v) from jsonb_each(p) e(k, v) where e.k in ('shift_start','shift_end','ot_start')), '{}'::jsonb),
         updated_by = (select auth.uid()), updated_at = now()
   where key = 'payroll';
end $$;
