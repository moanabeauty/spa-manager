-- Ngày nghỉ theo định mức tháng: tháng có N ngày thì được nghỉ N − 27 ngày (30 ngày -> 3, 31 ngày -> 4).
-- Nhân viên tự đăng ký các ngày nghỉ này, vẫn đủ lương nếu làm đủ 27 công (243 giờ) -> ngày nghỉ KHÔNG cộng giờ.
-- Đăng ký vượt định mức -> "nghỉ thêm, không lương". Nghỉ không đăng ký (quản lý ghi) -> trừ thêm 1 ngày lương.
-- Làm nửa ngày: ca sáng 9:00 – 13:30 hoặc ca chiều 13:30 – 18:00 (tính 0,5 ngày nghỉ).
-- Ngày lễ, Tết (chủ spa nhập): nghỉ hưởng nguyên lương -> mỗi ngày lễ cộng 9 giờ cho mọi nhân viên.

create table public.public_holidays (
  holiday_date date primary key,
  name text not null,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.public_holidays (created_by);
alter table public.public_holidays enable row level security;
create policy "staff read" on public.public_holidays for select to authenticated using ((select public.is_staff()));
create policy "owner write" on public.public_holidays for all to authenticated
  using ((select public.has_role('owner'))) with check ((select public.has_role('owner')));

alter table public.staff_leaves drop constraint staff_leaves_kind_check;
update public.staff_leaves set kind = 'off' where kind = 'paid';
alter table public.staff_leaves add constraint staff_leaves_kind_check check (kind in ('off','unpaid','unexcused'));
alter table public.staff_leaves add column work_shift text check (work_shift in ('morning','afternoon'));

drop function if exists public.request_leave(date, date, text, text, boolean);
create or replace function public.request_leave(p_from date, p_to date, p_reason text,
                                                p_half_day boolean default false, p_work_shift text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  d date; n int := 0;
  v_std numeric := coalesce((select (value->>'standard_days')::numeric from public.app_settings where key = 'payroll'), 27);
  v_quota numeric; v_used numeric; v_need numeric := case when coalesce(p_half_day, false) then 0.5 else 1 end;
begin
  if not public.is_staff() then raise exception 'Chỉ nhân viên'; end if;
  p_to := coalesce(p_to, p_from);
  if p_to < p_from or p_to - p_from > 30 then raise exception 'Khoảng ngày nghỉ không hợp lệ (tối đa 31 ngày)'; end if;
  if p_half_day and p_to <> p_from then raise exception 'Làm nửa ngày chỉ chọn 1 ngày'; end if;
  if p_half_day and coalesce(p_work_shift, '') not in ('morning','afternoon') then
    raise exception 'Chọn ca làm: sáng (9:00 – 13:30) hoặc chiều (13:30 – 18:00)';
  end if;
  v_std := coalesce((select standard_days from public.staff_pay_settings where staff_id = (select auth.uid())), v_std);
  for d in select generate_series(p_from, p_to, interval '1 day')::date loop
    if exists (select 1 from public.staff_leaves where staff_id = (select auth.uid()) and leave_date = d and status in ('pending','approved')) then
      raise exception 'Ngày % đã có đơn nghỉ', to_char(d, 'DD/MM');
    end if;
    v_quota := extract(day from (date_trunc('month', d) + interval '1 month - 1 day')) - v_std;
    select coalesce(sum(case when half_day then 0.5 else 1 end), 0) into v_used
      from public.staff_leaves
     where staff_id = (select auth.uid()) and kind = 'off' and status in ('pending','approved')
       and date_trunc('month', leave_date) = date_trunc('month', d);
    insert into public.staff_leaves (staff_id, leave_date, kind, half_day, work_shift, reason)
    values ((select auth.uid()), d, case when v_used + v_need <= v_quota then 'off' else 'unpaid' end,
            coalesce(p_half_day, false), case when p_half_day then p_work_shift end, nullif(trim(p_reason), ''));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.request_leave(date, date, text, boolean, text) from public, anon;
grant execute on function public.request_leave(date, date, text, boolean, text) to authenticated;

-- ngày nghỉ không cộng giờ vào lương nữa
create or replace function pg_temp.patch_fn(p_sig text, p_old text, p_new text)
returns void language plpgsql as $$
declare d text := pg_get_functiondef(p_sig::regprocedure);
begin
  if position(p_old in d) = 0 then raise exception 'Không tìm thấy đoạn cần sửa trong %', p_sig; end if;
  execute replace(d, p_old, p_new);
end $$;

select pg_temp.patch_fn('public._payroll_rows(date)',
  $o$  att as (select * from public._attendance_month(p_month)),$o$,
  $n$  att as (select * from public._attendance_month(p_month)),
  hol as (select count(*) as n from public.public_holidays h, m
           where h.holiday_date >= m.m and h.holiday_date < (m.m + interval '1 month')),$n$);
select pg_temp.patch_fn('public._payroll_rows(date)',
  $o$      cross join cfg
      left join public.staff_pay_settings s$o$,
  $n$      cross join cfg
      cross join hol
      left join public.staff_pay_settings s$n$);

select pg_temp.patch_fn('public._payroll_rows(date)',
  $o$coalesce(e.work_hours, coalesce(a.work_hours, 0) + coalesce(a.paid_leave_days, 0) * cfg.hpd) wh$o$,
  $n$coalesce(e.work_hours, coalesce(a.work_hours, 0) + hol.n * cfg.hpd) wh$n$);

select pg_temp.patch_fn('public._attendance_month(date)',
  $o$filter (where l.kind = 'paid') pl$o$,
  $n$filter (where l.kind = 'off') pl$n$);
