-- Ngày lễ: chủ spa chọn ngày lễ áp dụng cho tất cả hoặc chọn riêng nhân viên được nghỉ.
-- Nghỉ lễ: hưởng lương cơ bản (cộng 9 giờ), không phụ cấp ăn.
-- Đi làm ngày lễ của mình: ngoài lương ngày lễ, giờ làm hôm đó trả 300% (đơn giá = lương ÷ 27 ÷ 8), không tính vào giờ làm thường.

alter table public.public_holidays add column applies_to_all boolean not null default true;

create table public.holiday_assignments (
  holiday_date date not null references public.public_holidays(holiday_date) on delete cascade,
  staff_id uuid not null references public.profiles(id) on delete cascade,
  primary key (holiday_date, staff_id)
);
create index on public.holiday_assignments (staff_id);
alter table public.holiday_assignments enable row level security;
create policy "staff read" on public.holiday_assignments for select to authenticated using ((select public.is_staff()));
create policy "owner write" on public.holiday_assignments for all to authenticated
  using ((select public.has_role('owner'))) with check ((select public.has_role('owner')));

update public.app_settings set value = value || jsonb_build_object('holiday_work_rate', 3) where key = 'payroll';

create or replace function pg_temp.patch_fn(p_sig text, p_old text, p_new text)
returns void language plpgsql as $$
declare d text := pg_get_functiondef(p_sig::regprocedure);
begin
  if position(p_old in d) = 0 then raise exception 'Không tìm thấy đoạn cần sửa trong %', p_sig; end if;
  execute replace(d, p_old, p_new);
end $$;
select pg_temp.patch_fn('public.set_payroll_settings(jsonb)',
  $o$'bhxh_employer_pct','geo_radius_m'];$o$, $n$'bhxh_employer_pct','geo_radius_m','holiday_work_rate'];$n$);

drop function if exists public._payroll_rows(date);
create function public._payroll_rows(p_month date)
returns table (staff_id uuid, full_name text, role text, branch_id uuid, has_entry boolean,
               base_salary numeric, standard_days numeric, standard_hours numeric, work_hours numeric, paid_leave_days numeric,
               work_days numeric, base_pay numeric, holiday_days bigint, holiday_work_hours numeric, holiday_work_pay numeric,
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
           coalesce((value->>'holiday_work_rate')::numeric, 3) hwr,
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
  -- ngày lễ của từng nhân viên: lễ áp dụng cho tất cả, hoặc chủ spa chọn riêng người được nghỉ
  shol as (select p.id as staff_id, h.holiday_date
           from public.profiles p cross join m
           join public.public_holidays h on h.holiday_date >= m.m and h.holiday_date < (m.m + interval '1 month')
          where h.applies_to_all
             or exists (select 1 from public.holiday_assignments x where x.holiday_date = h.holiday_date and x.staff_id = p.id)),
  hol as (select shol.staff_id, count(*) as n from shol group by 1),
  hw as (select d.staff_id, sum(d.work_hours) as h
           from m, public._attendance_days(m.m, (m.m + interval '1 month - 1 day')::date) d
           join shol on shol.staff_id = d.staff_id and shol.holiday_date = d.work_date
          group by 1),
  base as (
    select p.id, p.full_name, p.role::text as role, p.branch_id,
           s.base_salary, s.responsibility_pay, s.insurance_salary, s.meal_per_day, s.standard_days as own_sd,
           (e.staff_id is not null or a.staff_id is not null) as has_entry,
           coalesce(a.paid_leave_days, 0) pld,
           coalesce(e.work_hours, coalesce(a.work_hours, 0) - coalesce(hw.h, 0) + coalesce(hol.n, 0) * cfg.hpd) wh,
           coalesce(hol.n, 0) hol_n, coalesce(hw.h, 0) hw_h,
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
      left join hol on hol.staff_id = p.id
      left join hw on hw.staff_id = p.id
     where p.role <> 'customer'
       and coalesce(s.on_payroll, true)
       and ((p.is_active and p.role <> 'owner') or s.staff_id is not null or e.staff_id is not null
            or c.staff_id is not null or f.staff_id is not null or pe.staff_id is not null or a.staff_id is not null)
  ), calc as (
    select b.*, cfg.hpd, cfg.othpd, cfg.otr, cfg.meal, cfg.ee, cfg.er,
           round(coalesce(b.base_salary, 0) / coalesce(b.own_sd, cfg.sd) / cfg.othpd * b.hw_h * cfg.hwr) as hw_pay,
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
         coalesce(c.base_salary, 0), c.sd, c.sh, c.wh, c.pld, c.wd, c.base_pay, c.hol_n::bigint, c.hw_h, c.hw_pay,
         coalesce(c.responsibility_pay, 0), c.meal_pay, c.ot, c.ot_pay,
         c.sales, c.rate, c.comm, c.done::bigint, c.fee, c.oa,
         c.base_pay + c.hw_pay + coalesce(c.responsibility_pay, 0) + c.meal_pay + c.ot_pay + c.comm + c.fee + c.oa,
         c.pen, c.pen_n::bigint, c.ab::bigint, c.ab_ded,
         coalesce(c.insurance_salary, 0), c.ins_ee, c.od,
         c.base_pay + c.hw_pay + coalesce(c.responsibility_pay, 0) + c.meal_pay + c.ot_pay + c.comm + c.fee + c.oa
           - c.pen - c.ab_ded - c.ins_ee - c.od,
         c.ins_er, c.note
    from calc c
   order by case c.role when 'manager' then 0 when 'receptionist' then 1 when 'technician' then 2 else 3 end, c.full_name
$$;
revoke execute on function public._payroll_rows(date) from public, anon, authenticated;

-- giờ làm ngày lễ tính theo giờ có mặt (9 giờ / ngày gồm nghỉ trưa): 1 ngày lễ đi làm đủ = 300% lương 1 ngày
select pg_temp.patch_fn('public._payroll_rows(date)',
  $o$round(coalesce(b.base_salary, 0) / coalesce(b.own_sd, cfg.sd) / cfg.othpd * b.hw_h * cfg.hwr) as hw_pay$o$,
  $n$round(coalesce(b.base_salary, 0) / coalesce(b.own_sd, cfg.sd) / cfg.hpd * b.hw_h * cfg.hwr) as hw_pay$n$);
