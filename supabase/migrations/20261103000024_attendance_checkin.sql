-- Chấm công bằng check-in / check-out + ngày công chuẩn riêng (KTV 27 công)
-- Ca làm 9:00 – 18:00, nghỉ trưa 1 tiếng = 8 giờ / công.
-- Ngày công 1 người / ngày: làm ≥ 6 giờ = 1 công, 3 – 6 giờ = 0,5 công, dưới 3 giờ hoặc quên check-out = 0 (quản lý sửa).
-- Giờ thêm: thời gian check-out sau 18:00, tính theo từng nửa tiếng.
-- Bảng lương lấy số ở tab Chấm công nếu quản lý đã lưu, chưa lưu thì lấy từ check-in / out.

update public.app_settings
   set value = value || jsonb_build_object('standard_days', 27, 'hours_per_day', 8,
         'shift_start', '09:00', 'shift_end', '18:00', 'lunch_minutes', 60, 'full_day_hours', 6, 'half_day_hours', 3)
 where key = 'payroll';

-- ngày công chuẩn riêng từng người (bỏ trống = theo mức chung)
alter table public.staff_pay_settings add column standard_days numeric(4,1) check (standard_days > 0);

create or replace function public.set_payroll_settings(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa được đổi cài đặt lương'; end if;
  foreach k in array array['standard_days','hours_per_day','overtime_rate','meal_per_day','bhxh_employee_pct','bhxh_employer_pct',
                           'lunch_minutes','full_day_hours','half_day_hours'] loop
    if p ? k and ((p->>k)::numeric < 0 or (k in ('standard_days','hours_per_day') and (p->>k)::numeric <= 0)) then
      raise exception 'Giá trị % không hợp lệ', k;
    end if;
  end loop;
  foreach k in array array['shift_start','shift_end'] loop
    if p ? k and (p->>k) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Giờ % không hợp lệ (vd 09:00)', k; end if;
  end loop;
  update public.app_settings
     set value = value
       || coalesce((select jsonb_object_agg(e.k, to_jsonb((e.v #>> '{}')::numeric)) from jsonb_each(p) e(k, v)
                     where e.k in ('standard_days','hours_per_day','overtime_rate','meal_per_day','bhxh_employee_pct','bhxh_employer_pct',
                                   'lunch_minutes','full_day_hours','half_day_hours')), '{}'::jsonb)
       || coalesce((select jsonb_object_agg(e.k, e.v) from jsonb_each(p) e(k, v) where e.k in ('shift_start','shift_end')), '{}'::jsonb),
         updated_by = (select auth.uid()), updated_at = now()
   where key = 'payroll';
end $$;

create table public.staff_attendance (
  staff_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  branch_id uuid references public.branches(id),
  check_in timestamptz not null,
  check_out timestamptz,
  note text,
  edited_by uuid references public.profiles(id),
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (staff_id, work_date),
  check (check_out is null or check_out > check_in)
);
create index on public.staff_attendance (work_date);
create index on public.staff_attendance (branch_id);
create index on public.staff_attendance (edited_by);
alter table public.staff_attendance enable row level security;
create policy "own or management read" on public.staff_attendance for select to authenticated
  using (staff_id = (select auth.uid()) or (select public.has_role('owner','manager')));
create policy "management write" on public.staff_attendance for all to authenticated
  using ((select public.has_role('owner','manager'))) with check ((select public.has_role('owner','manager')));

-- nhân viên tự bấm: giờ lấy theo máy chủ (không sửa được giờ trên điện thoại)
create or replace function public.check_in()
returns public.staff_attendance language plpgsql security definer set search_path = '' as $$
declare v public.staff_attendance; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if not public.has_role('manager','receptionist','technician','warehouse','owner') then raise exception 'Chỉ nhân viên'; end if;
  insert into public.staff_attendance (staff_id, work_date, branch_id, check_in)
  values ((select auth.uid()), v_today, (select branch_id from public.profiles where id = (select auth.uid())), now())
  on conflict (staff_id, work_date) do nothing;
  select * into v from public.staff_attendance where staff_id = (select auth.uid()) and work_date = v_today;
  return v;
end $$;
revoke execute on function public.check_in() from public, anon;
grant execute on function public.check_in() to authenticated;

create or replace function public.check_out()
returns public.staff_attendance language plpgsql security definer set search_path = '' as $$
declare v public.staff_attendance; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  update public.staff_attendance set check_out = now()
   where staff_id = (select auth.uid()) and work_date = v_today
  returning * into v;
  if not found then raise exception 'Hôm nay bạn chưa check-in'; end if;
  return v;
end $$;
revoke execute on function public.check_out() from public, anon;
grant execute on function public.check_out() to authenticated;

-- công + giờ thêm từng ngày
create or replace function public._attendance_days(p_from date, p_to date)
returns table (staff_id uuid, work_date date, check_in timestamptz, check_out timestamptz, net_hours numeric, days numeric, ot_hours numeric)
language sql stable security definer set search_path = '' as $$
  with cfg as (
    select coalesce((value->>'shift_end'), '18:00')::time as se,
           coalesce((value->>'lunch_minutes')::numeric, 60) as lunch,
           coalesce((value->>'full_day_hours')::numeric, 6) as full_h,
           coalesce((value->>'half_day_hours')::numeric, 3) as half_h
      from public.app_settings where key = 'payroll'
  ), x as (
    select a.staff_id, a.work_date, a.check_in, a.check_out,
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
         case when h.check_out is null then 0 when h.net >= h.full_h then 1 when h.net >= h.half_h then 0.5 else 0 end,
         case when h.check_out is null or h.tout <= h.se then 0
              else floor(extract(epoch from h.tout - h.se) / 1800) / 2 end
    from h
$$;
revoke execute on function public._attendance_days(date, date) from public, anon, authenticated;

create or replace function public._attendance_month(p_month date)
returns table (staff_id uuid, days numeric, ot_hours numeric, records bigint, missing_out bigint)
language sql stable security definer set search_path = '' as $$
  select d.staff_id, sum(d.days), sum(d.ot_hours), count(*), count(*) filter (where d.check_out is null)
    from public._attendance_days(date_trunc('month', p_month)::date,
                                 (date_trunc('month', p_month) + interval '1 month - 1 day')::date) d
   group by 1
$$;
revoke execute on function public._attendance_month(date) from public, anon, authenticated;

-- quản lý / chủ: chi tiết check-in / out trong tháng (nhân viên xem của mình)
create or replace function public.attendance_report(p_month date)
returns table (staff_id uuid, work_date date, check_in timestamptz, check_out timestamptz, net_hours numeric, days numeric,
               ot_hours numeric, note text, edited boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Chỉ nhân viên'; end if;
  return query
  select d.staff_id, d.work_date, d.check_in, d.check_out, d.net_hours, d.days, d.ot_hours, a.note, a.edited_by is not null
    from public._attendance_days(date_trunc('month', p_month)::date,
                                 (date_trunc('month', p_month) + interval '1 month - 1 day')::date) d
    join public.staff_attendance a on a.staff_id = d.staff_id and a.work_date = d.work_date
   where public.has_role('owner','manager') or d.staff_id = (select auth.uid())
   order by d.work_date desc, d.staff_id;
end $$;
revoke execute on function public.attendance_report(date) from public, anon;
grant execute on function public.attendance_report(date) to authenticated;

-- quản lý sửa giờ (quên check-out, check-in hộ...)
create or replace function public.save_attendance(p_staff uuid, p_date date, p_in timestamptz, p_out timestamptz, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ quản lý / chủ spa sửa được chấm công'; end if;
  if p_in is null then
    delete from public.staff_attendance where staff_id = p_staff and work_date = p_date;
    return;
  end if;
  if p_out is not null and p_out <= p_in then raise exception 'Giờ check-out phải sau giờ check-in'; end if;
  insert into public.staff_attendance (staff_id, work_date, branch_id, check_in, check_out, note, edited_by, edited_at)
  values (p_staff, p_date, (select branch_id from public.profiles where id = p_staff), p_in, p_out, nullif(trim(p_note), ''),
          (select auth.uid()), now())
  on conflict (staff_id, work_date) do update
    set check_in = excluded.check_in, check_out = excluded.check_out, note = excluded.note,
        edited_by = excluded.edited_by, edited_at = now();
end $$;
revoke execute on function public.save_attendance(uuid, date, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.save_attendance(uuid, date, timestamptz, timestamptz, text) to authenticated;

-- tổng công theo check-in trong tháng (để tab Chấm công so sánh / điền)
create or replace function public.attendance_month(p_month date)
returns table (staff_id uuid, days numeric, ot_hours numeric, records bigint, missing_out bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ quản lý / chủ spa'; end if;
  return query select * from public._attendance_month(p_month);
end $$;
revoke execute on function public.attendance_month(date) from public, anon;
grant execute on function public.attendance_month(date) to authenticated;

-- bảng lương: ngày công chuẩn riêng + lấy công từ check-in khi chưa nhập tay
create or replace function public._payroll_rows(p_month date)
returns table (staff_id uuid, full_name text, role text, branch_id uuid, has_entry boolean,
               base_salary numeric, standard_days numeric, work_days numeric, base_pay numeric,
               responsibility_pay numeric, meal_allowance numeric, overtime_hours numeric, overtime_pay numeric,
               sales_amount numeric, commission_rate numeric, commission numeric, services_done bigint, service_fee numeric,
               other_allowance numeric, gross_pay numeric, penalties numeric, penalty_count bigint,
               insurance_salary numeric, insurance_employee numeric, other_deduction numeric, net_pay numeric,
               insurance_employer numeric, note text)
language sql stable security definer set search_path = '' as $$
  with cfg as (
    select (value->>'standard_days')::numeric sd, (value->>'hours_per_day')::numeric hpd,
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
           coalesce(e.work_days, a.days, 0) wd, coalesce(e.overtime_hours, a.ot_hours, 0) ot,
           coalesce(e.other_allowance, 0) oa, coalesce(e.other_deduction, 0) od, e.note,
           coalesce(c.sales_amount, 0) sales, coalesce(c.rate, 0) rate, coalesce(c.commission_amount, 0) comm,
           coalesce(f.services_done, 0) done, coalesce(f.fee_amount, 0) fee,
           coalesce(pe.amt, 0) pen, coalesce(pe.n, 0) pen_n
      from public.profiles p
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
    select b.*, cfg.hpd, cfg.otr, cfg.meal, cfg.ee, cfg.er, coalesce(b.own_sd, cfg.sd) as sd,
           round(coalesce(b.base_salary, 0) * b.wd / coalesce(b.own_sd, cfg.sd)) as base_pay,
           round(b.wd * coalesce(b.meal_per_day, cfg.meal)) as meal_pay,
           round(coalesce(b.base_salary, 0) / coalesce(b.own_sd, cfg.sd) / cfg.hpd * b.ot * cfg.otr) as ot_pay,
           round(coalesce(b.insurance_salary, 0) * cfg.ee / 100) as ins_ee,
           round(coalesce(b.insurance_salary, 0) * cfg.er / 100) as ins_er
      from base b cross join cfg
  )
  select c.id, c.full_name, c.role, c.branch_id, c.has_entry,
         coalesce(c.base_salary, 0), c.sd, c.wd, c.base_pay,
         coalesce(c.responsibility_pay, 0), c.meal_pay, c.ot, c.ot_pay,
         c.sales, c.rate, c.comm, c.done::bigint, c.fee, c.oa,
         c.base_pay + coalesce(c.responsibility_pay, 0) + c.meal_pay + c.ot_pay + c.comm + c.fee + c.oa,
         c.pen, c.pen_n::bigint, coalesce(c.insurance_salary, 0), c.ins_ee, c.od,
         c.base_pay + coalesce(c.responsibility_pay, 0) + c.meal_pay + c.ot_pay + c.comm + c.fee + c.oa
           - c.pen - c.ins_ee - c.od,
         c.ins_er, c.note
    from calc c
   order by case c.role when 'manager' then 0 when 'receptionist' then 1 when 'technician' then 2 else 3 end, c.full_name
$$;
revoke execute on function public._payroll_rows(date) from public, anon, authenticated;
