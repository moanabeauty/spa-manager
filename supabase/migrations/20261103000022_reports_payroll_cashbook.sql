-- Giai đoạn 7: báo cáo cho chủ spa
-- 1. Doanh thu theo ngày / tháng / chi nhánh: tiền thực thu, tiền trừ thẻ, theo loại (dịch vụ / gói / sản phẩm / nạp thẻ)
-- 2. Gói & thẻ: số buổi còn nợ khách mua combo, số tiền thực nợ khách có thẻ (theo tỉ lệ mệnh giá / tổng tiền nhận)
-- 3. Bảng lương: lương cơ bản theo ngày công, trách nhiệm, phụ cấp ăn, thêm giờ ×150%, hoa hồng, tiền dịch vụ,
--    trừ phạt nội quy, trừ BHXH người lao động; tiền BHXH Moana đóng cho nhân viên
-- 4. Sổ thu / chi: nhập mọi khoản thu chi, lên dòng tiền + % lợi nhuận tháng / năm
-- 5. Thông báo điện thoại (web push) cho chủ spa khi có yêu cầu giảm giá

-- ============ 1. DOANH THU ============
-- kind = 'line'   : key = loại dòng (service / package / product / card_topup), thêm ':card' nếu trừ thẻ
--        'pay'    : key = hình thức thu (cash / bank_transfer / pos / service_card)
--        'refund' : key = hình thức hoàn (tiền hoàn huỷ gói / thẻ)
create or replace function public.revenue_report(p_from date, p_to date, p_branch uuid default null)
returns table (day date, branch_id uuid, kind text, key text, amount numeric, cnt bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ chủ spa / quản lý xem được báo cáo'; end if;
  return query
  select (i.paid_at at time zone 'Asia/Ho_Chi_Minh')::date, i.branch_id, 'line'::text,
         ii.item_type::text || case when ii.paid_with_card then ':card' else '' end,
         sum(ii.amount), sum(ii.quantity)::bigint
    from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
   where i.status = 'paid'
     and (i.paid_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
     and (p_branch is null or i.branch_id = p_branch)
   group by 1, 2, 4
  union all
  select (i.paid_at at time zone 'Asia/Ho_Chi_Minh')::date, i.branch_id, 'pay', p.method::text, sum(p.amount), count(distinct i.id)
    from public.payments p join public.invoices i on i.id = p.invoice_id
   where i.status = 'paid'
     and (i.paid_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
     and (p_branch is null or i.branch_id = p_branch)
   group by 1, 2, 4
  union all
  select (r.created_at at time zone 'Asia/Ho_Chi_Minh')::date, r.branch_id, 'refund', r.method::text, sum(r.refund_amount), count(*)
    from public.refunds r
   where (r.created_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
     and (p_branch is null or r.branch_id = p_branch)
   group by 1, 2, 4;
end $$;
revoke execute on function public.revenue_report(date, date, uuid) from public, anon;
grant execute on function public.revenue_report(date, date, uuid) to authenticated;

-- bán chạy: dịch vụ / gói / sản phẩm / nạp thẻ theo tên
create or replace function public.sales_by_item(p_from date, p_to date, p_branch uuid default null)
returns table (item_type text, name text, qty bigint, amount numeric, card_amount numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ chủ spa / quản lý xem được báo cáo'; end if;
  return query
  select ii.item_type::text,
         coalesce(s.name, pk.name, pr.name, case when t.id is not null then 'Nạp thẻ ' || to_char(t.topup_amount, 'FM999G999G999') || 'đ' end, ii.description, '?'),
         sum(ii.quantity)::bigint, sum(ii.amount), coalesce(sum(ii.amount) filter (where ii.paid_with_card), 0)
    from public.invoice_items ii
    join public.invoices i on i.id = ii.invoice_id
    left join public.services s on s.id = ii.service_id
    left join public.packages pk on pk.id = ii.package_id
    left join public.products pr on pr.id = ii.product_id
    left join public.card_topup_tiers t on t.id = ii.topup_tier_id
   where i.status = 'paid'
     and (i.paid_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
     and (p_branch is null or i.branch_id = p_branch)
   group by 1, 2
   order by 4 desc;
end $$;
revoke execute on function public.sales_by_item(date, date, uuid) from public, anon;
grant execute on function public.sales_by_item(date, date, uuid) to authenticated;

-- ============ 2. TIỀN / BUỔI CÒN NỢ KHÁCH ============
-- Thẻ: số dư gồm cả tiền tặng; tiền thực nợ = số dư × mệnh giá đã nạp / (mệnh giá + tiền tặng)
--      vd nạp 10tr được 13tr, còn 6,5tr  -> thực nợ 6,5tr × 10/13 = 5tr
create or replace function public.card_liabilities()
returns table (card_id uuid, code text, customer_id uuid, customer_name text, phone text, branch_id uuid,
               topup numeric, bonus numeric, balance numeric, real_owed numeric, last_used_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ chủ spa / quản lý xem được báo cáo'; end if;
  return query
  with t as (
    select c.id, c.code, c.customer_id,
           coalesce(sum(x.amount), 0) as balance,
           coalesce(sum(x.amount) filter (where x.txn_type = 'topup' and (i.id is null or i.status = 'paid')), 0) as topup,
           coalesce(sum(x.amount) filter (where x.txn_type = 'bonus' and (i.id is null or i.status = 'paid')), 0) as bonus,
           max(x.created_at) filter (where x.txn_type = 'charge') as last_used_at,
           (array_agg(i.branch_id order by x.created_at desc) filter (where x.txn_type = 'topup' and i.status = 'paid'))[1] as branch_id
      from public.service_cards c
      left join public.card_transactions x on x.card_id = c.id
      left join public.invoices i on i.id = x.invoice_id
     where c.is_active
     group by c.id
  )
  select t.id, t.code, t.customer_id, cu.full_name, cu.phone, coalesce(t.branch_id, cu.home_branch_id),
         t.topup, t.bonus, t.balance,
         case when t.topup + t.bonus > 0 then round(t.balance * t.topup / (t.topup + t.bonus)) else t.balance end,
         t.last_used_at
    from t join public.customers cu on cu.id = t.customer_id
   where t.balance > 0
   order by t.balance desc;
end $$;
revoke execute on function public.card_liabilities() from public, anon;
grant execute on function public.card_liabilities() to authenticated;

-- Gói combo: số buổi còn lại + giá trị còn nợ (= giá mua − buổi đã dùng × giá lẻ / buổi, giống công thức hoàn tiền)
create or replace function public.package_liabilities()
returns table (customer_package_id uuid, customer_id uuid, customer_name text, phone text, branch_id uuid,
               package_name text, purchased_at timestamptz, expires_at timestamptz, expired boolean,
               paid numeric, used_sessions bigint, used_value numeric, remaining_sessions bigint,
               has_unlimited boolean, owed_value numeric, items jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ chủ spa / quản lý xem được báo cáo'; end if;
  return query
  with used as (
    select aps.customer_package_id as id, count(*) as n,
           sum(coalesce(ci.unit_price, s.price, aps.price, 0)) as v
      from public.appointment_services aps
      join public.appointments a on a.id = aps.appointment_id and a.status = 'completed'
      join public.services s on s.id = aps.service_id
      left join public.customer_package_items ci on ci.id = aps.customer_package_item_id
     where aps.customer_package_id is not null
     group by 1
  ), it as (
    select ci.customer_package_id as id,
           sum(greatest(0, ci.total_qty - ci.used_qty)) filter (where ci.total_qty is not null) as remaining,
           bool_or(ci.total_qty is null) as unlimited,
           jsonb_agg(jsonb_build_object('label', ci.label, 'total', ci.total_qty, 'used', ci.used_qty) order by ci.sort_order) as items
      from public.customer_package_items ci group by 1
  )
  select cp.id, cp.customer_id, cu.full_name, cu.phone, coalesce(i.branch_id, cu.home_branch_id),
         pk.name, cp.purchased_at, cp.expires_at, coalesce(cp.expires_at < now(), false),
         coalesce(ii.amount / ii.quantity, 0), coalesce(u.n, 0), coalesce(u.v, 0),
         coalesce(it.remaining, 0)::bigint, coalesce(it.unlimited, false),
         greatest(0, coalesce(ii.amount / ii.quantity, 0) - coalesce(u.v, 0)),
         coalesce(it.items, '[]'::jsonb)
    from public.customer_packages cp
    join public.customers cu on cu.id = cp.customer_id
    join public.packages pk on pk.id = cp.package_id
    left join public.invoice_items ii on ii.id = cp.invoice_item_id
    left join public.invoices i on i.id = ii.invoice_id
    left join used u on u.id = cp.id
    left join it on it.id = cp.id
   where cp.is_active
     and (i.id is null or i.status = 'paid')
     and (coalesce(it.remaining, 0) > 0 or coalesce(it.unlimited, false))
   order by cp.purchased_at desc;
end $$;
revoke execute on function public.package_liabilities() from public, anon;
grant execute on function public.package_liabilities() to authenticated;

-- ============ 3. BẢNG LƯƠNG ============
insert into public.app_settings (key, value) values ('payroll', jsonb_build_object(
  'standard_days', 26,        -- ngày công chuẩn / tháng
  'hours_per_day', 8,         -- giờ / ngày công (tính đơn giá giờ thêm)
  'overtime_rate', 1.5,       -- thêm giờ ×150%
  'meal_per_day', 30000,      -- phụ cấp ăn / ngày công
  'bhxh_employee_pct', 10.5,  -- người lao động: 8% BHXH + 1,5% BHYT + 1% BHTN
  'bhxh_employer_pct', 21.5   -- Moana đóng: 17,5% BHXH + 3% BHYT + 1% BHTN
)) on conflict (key) do nothing;

create or replace function public.set_payroll_settings(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa được đổi cài đặt lương'; end if;
  foreach k in array array['standard_days','hours_per_day','overtime_rate','meal_per_day','bhxh_employee_pct','bhxh_employer_pct'] loop
    if p ? k and ((p->>k)::numeric < 0 or (k in ('standard_days','hours_per_day') and (p->>k)::numeric <= 0)) then
      raise exception 'Giá trị % không hợp lệ', k;
    end if;
  end loop;
  update public.app_settings
     set value = value || coalesce((select jsonb_object_agg(e.k, to_jsonb((e.v #>> '{}')::numeric)) from jsonb_each(p) e(k, v)
                            where e.k in ('standard_days','hours_per_day','overtime_rate','meal_per_day','bhxh_employee_pct','bhxh_employer_pct')), '{}'::jsonb),
         updated_by = (select auth.uid()), updated_at = now()
   where key = 'payroll';
end $$;
revoke execute on function public.set_payroll_settings(jsonb) from public, anon;
grant execute on function public.set_payroll_settings(jsonb) to authenticated;

-- mức lương từng nhân viên (chỉ chủ spa)
create table public.staff_pay_settings (
  staff_id uuid primary key references public.profiles(id) on delete cascade,
  base_salary numeric(12,0) not null default 0 check (base_salary >= 0),          -- lương cơ bản / tháng (đủ ngày công chuẩn)
  responsibility_pay numeric(12,0) not null default 0 check (responsibility_pay >= 0), -- lương trách nhiệm / tháng
  insurance_salary numeric(12,0) not null default 0 check (insurance_salary >= 0),  -- lương đóng BHXH (0 = không đóng)
  meal_per_day numeric(12,0) check (meal_per_day >= 0),                           -- bỏ trống = theo mức chung 30k
  on_payroll boolean not null default true,
  note text,
  updated_by uuid references public.profiles(id) default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.staff_pay_settings enable row level security;
create policy "owner all" on public.staff_pay_settings for all to authenticated
  using ((select public.has_role('owner'))) with check ((select public.has_role('owner')));

-- chấm công tháng: ngày công, giờ thêm, khoản cộng / trừ khác (chủ + quản lý nhập)
create table public.payroll_entries (
  month date not null check (extract(day from month) = 1),
  staff_id uuid not null references public.profiles(id) on delete cascade,
  work_days numeric(5,1) not null default 0 check (work_days >= 0 and work_days <= 31),
  overtime_hours numeric(6,1) not null default 0 check (overtime_hours >= 0),
  other_allowance numeric(12,0) not null default 0 check (other_allowance >= 0),
  other_deduction numeric(12,0) not null default 0 check (other_deduction >= 0),
  note text,
  updated_by uuid references public.profiles(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (month, staff_id)
);
create index on public.payroll_entries (staff_id);
alter table public.payroll_entries enable row level security;
create policy "management or own read" on public.payroll_entries for select to authenticated
  using (staff_id = (select auth.uid()) or (select public.has_role('owner','manager')));
create policy "management write" on public.payroll_entries for all to authenticated
  using ((select public.has_role('owner','manager'))) with check ((select public.has_role('owner','manager')));

-- phạt theo nội quy
create table public.staff_penalties (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id) on delete cascade,
  penalty_date date not null default ((now() at time zone 'Asia/Ho_Chi_Minh')::date),
  amount numeric(12,0) not null check (amount > 0),
  reason text not null check (length(trim(reason)) > 0),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.staff_penalties (staff_id, penalty_date);
create index on public.staff_penalties (created_by);
alter table public.staff_penalties enable row level security;
create policy "management or own read" on public.staff_penalties for select to authenticated
  using (staff_id = (select auth.uid()) or (select public.has_role('owner','manager')));
create policy "management write" on public.staff_penalties for all to authenticated
  using ((select public.has_role('owner','manager'))) with check ((select public.has_role('owner','manager')));

-- tính lương (nội bộ, không gọi trực tiếp)
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
  base as (
    select p.id, p.full_name, p.role::text as role, p.branch_id,
           s.base_salary, s.responsibility_pay, s.insurance_salary, s.meal_per_day,
           e.staff_id is not null as has_entry,
           coalesce(e.work_days, 0) wd, coalesce(e.overtime_hours, 0) ot,
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
     where p.role <> 'customer'
       and coalesce(s.on_payroll, true)
       and ((p.is_active and p.role <> 'owner') or s.staff_id is not null or e.staff_id is not null
            or c.staff_id is not null or f.staff_id is not null or pe.staff_id is not null)
  ), calc as (
    select b.*, cfg.*,
           round(coalesce(b.base_salary, 0) * b.wd / cfg.sd) as base_pay,
           round(b.wd * coalesce(b.meal_per_day, cfg.meal)) as meal_pay,
           round(coalesce(b.base_salary, 0) / cfg.sd / cfg.hpd * b.ot * cfg.otr) as ot_pay,
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


-- chủ spa: cả bảng lương
create or replace function public.payroll_sheet(p_month date)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa xem được bảng lương'; end if;
  return query select to_jsonb(r) from public._payroll_rows(p_month) r;
end $$;
revoke execute on function public.payroll_sheet(date) from public, anon;
grant execute on function public.payroll_sheet(date) to authenticated;

-- nhân viên: phiếu lương của mình
create or replace function public.my_payslip(p_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not public.is_staff() then raise exception 'Chỉ nhân viên'; end if;
  select to_jsonb(r) into v from public._payroll_rows(p_month) r where r.staff_id = (select auth.uid());
  return v;
end $$;
revoke execute on function public.my_payslip(date) from public, anon;
grant execute on function public.my_payslip(date) to authenticated;

-- ============ 4. SỔ THU / CHI ============
create table public.cashbook_categories (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('income','expense')),
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  unique (kind, name)
);
alter table public.cashbook_categories enable row level security;
create policy "owner all" on public.cashbook_categories for all to authenticated
  using ((select public.has_role('owner'))) with check ((select public.has_role('owner')));

insert into public.cashbook_categories (kind, name, sort_order) values
  ('income',  'Thu khác', 1),
  ('income',  'Chủ góp vốn / bổ sung tiền', 2),
  ('expense', 'Lương nhân viên', 1),
  ('expense', 'BHXH, BHYT, BHTN', 2),
  ('expense', 'Thuê mặt bằng', 3),
  ('expense', 'Điện, nước, internet', 4),
  ('expense', 'Nhập mỹ phẩm / sản phẩm', 5),
  ('expense', 'Vật tư tiêu hao', 6),
  ('expense', 'Máy móc, thiết bị, sửa chữa', 7),
  ('expense', 'Marketing, quảng cáo', 8),
  ('expense', 'Thuế, phí', 9),
  ('expense', 'Chi khác', 10);

create table public.cashbook_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default ((now() at time zone 'Asia/Ho_Chi_Minh')::date),
  branch_id uuid references public.branches(id),            -- null = chung cả 2 chi nhánh
  kind text not null check (kind in ('income','expense')),
  category_id uuid not null references public.cashbook_categories(id),
  amount numeric(14,0) not null check (amount > 0),
  method text not null default 'cash' check (method in ('cash','bank_transfer','pos','other')),
  description text,
  source text not null default 'manual' check (source in ('manual','payroll')),
  source_month date,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.cashbook_entries (entry_date);
create index on public.cashbook_entries (category_id);
create index on public.cashbook_entries (branch_id);
create index on public.cashbook_entries (created_by);
create unique index cashbook_payroll_once on public.cashbook_entries (source_month, category_id) where source = 'payroll';
alter table public.cashbook_entries enable row level security;
create policy "owner all" on public.cashbook_entries for all to authenticated
  using ((select public.has_role('owner'))) with check ((select public.has_role('owner')));

create or replace function public.cashbook_entries_check()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.cashbook_categories where id = new.category_id and kind = new.kind) then
    raise exception 'Danh mục không đúng loại thu / chi';
  end if;
  return new;
end $$;
create trigger cashbook_entries_biu before insert or update on public.cashbook_entries
for each row execute function public.cashbook_entries_check();

-- dòng tiền năm: tiền bán hàng thực thu (không tính trừ thẻ), tiền hoàn khách, sổ thu chi
create or replace function public.cashflow_report(p_year int, p_branch uuid default null)
returns table (month int, kind text, source text, category text, amount numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa xem được dòng tiền'; end if;
  return query
  select extract(month from i.paid_at at time zone 'Asia/Ho_Chi_Minh')::int, 'income'::text, 'sales'::text,
         'Thu bán hàng tại quầy'::text, sum(p.amount)
    from public.payments p join public.invoices i on i.id = p.invoice_id
   where i.status = 'paid' and p.method <> 'service_card'
     and extract(year from i.paid_at at time zone 'Asia/Ho_Chi_Minh') = p_year
     and (p_branch is null or i.branch_id = p_branch)
   group by 1
  union all
  select extract(month from r.created_at at time zone 'Asia/Ho_Chi_Minh')::int, 'expense', 'refund',
         'Hoàn tiền khách (huỷ gói / thẻ)', sum(r.refund_amount)
    from public.refunds r
   where r.refund_amount > 0 and extract(year from r.created_at at time zone 'Asia/Ho_Chi_Minh') = p_year
     and (p_branch is null or r.branch_id = p_branch)
   group by 1
  union all
  select extract(month from e.entry_date)::int, e.kind, e.source, c.name, sum(e.amount)
    from public.cashbook_entries e join public.cashbook_categories c on c.id = e.category_id
   where extract(year from e.entry_date) = p_year
     and (p_branch is null or e.branch_id = p_branch)
   group by 1, 2, 3, 4;
end $$;
revoke execute on function public.cashflow_report(int, uuid) from public, anon;
grant execute on function public.cashflow_report(int, uuid) to authenticated;

-- ghi bảng lương tháng vào sổ chi (bấm lại thì cập nhật số mới, không ghi trùng)
create or replace function public.post_payroll_to_cashbook(p_month date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_m date := date_trunc('month', p_month)::date;
  v_net numeric; v_ins numeric;
  v_cat_pay uuid; v_cat_ins uuid;
  v_day date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa được ghi sổ chi'; end if;
  select coalesce(sum(net_pay), 0), coalesce(sum(insurance_employee + insurance_employer), 0)
    into v_net, v_ins from public._payroll_rows(v_m);
  select id into v_cat_pay from public.cashbook_categories where kind = 'expense' and name = 'Lương nhân viên';
  select id into v_cat_ins from public.cashbook_categories where kind = 'expense' and name = 'BHXH, BHYT, BHTN';
  if v_cat_pay is null or v_cat_ins is null then raise exception 'Thiếu danh mục "Lương nhân viên" / "BHXH, BHYT, BHTN"'; end if;

  delete from public.cashbook_entries where source = 'payroll' and source_month = v_m;
  if v_net > 0 then
    insert into public.cashbook_entries (entry_date, kind, category_id, amount, method, description, source, source_month)
    values (v_day, 'expense', v_cat_pay, v_net, 'bank_transfer', 'Lương thực nhận tháng ' || to_char(v_m, 'MM/YYYY'), 'payroll', v_m);
  end if;
  if v_ins > 0 then
    insert into public.cashbook_entries (entry_date, kind, category_id, amount, method, description, source, source_month)
    values (v_day, 'expense', v_cat_ins, v_ins, 'bank_transfer',
            'BHXH tháng ' || to_char(v_m, 'MM/YYYY') || ' (phần nhân viên + phần Moana đóng)', 'payroll', v_m);
  end if;
end $$;
revoke execute on function public.post_payroll_to_cashbook(date) from public, anon;
grant execute on function public.post_payroll_to_cashbook(date) to authenticated;

-- ============ 5. THÔNG BÁO ĐIỆN THOẠI ============
create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "own read" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy "own delete" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Chỉ nhân viên bật được thông báo'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Thông tin thông báo không hợp lệ';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
  values (p_endpoint, (select auth.uid()), p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh,
    auth = excluded.auth, user_agent = excluded.user_agent, created_at = now();
end $$;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- thiết bị đã gỡ / hết hạn: server gỡ khi gửi lỗi 404 / 410
create or replace function public.drop_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint
$$;
revoke execute on function public.drop_push_subscription(text) from public, anon;
grant execute on function public.drop_push_subscription(text) to authenticated;

alter table public.discount_requests add column notified_at timestamptz;

-- người vừa gửi yêu cầu giảm giá lấy danh sách điện thoại của chủ spa để báo (mỗi yêu cầu báo 1 lần)
create or replace function public.discount_push_targets(p_request uuid)
returns table (sub_endpoint text, sub_p256dh text, sub_auth text, title text, body text)
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select d.*, b.name as branch_name, p.full_name as requester, c.full_name as customer_name
    into r
    from public.discount_requests d
    join public.branches b on b.id = d.branch_id
    left join public.profiles p on p.id = d.requested_by
    left join public.customers c on c.id = d.customer_id
   where d.id = p_request and d.requested_by = (select auth.uid()) and d.status = 'pending'
     and d.notified_at is null and d.created_at > now() - interval '15 minutes'
   for update of d;
  if not found then return; end if;
  update public.discount_requests set notified_at = now() where id = p_request;
  return query
  select s.endpoint, s.p256dh, s.auth,
         'Xin giảm ' || to_char(r.amount, 'FM999G999G999') || 'đ',
         coalesce(r.requester, 'Nhân viên') || ' · ' || replace(r.branch_name, 'Moana ', '')
           || coalesce(' · khách ' || r.customer_name, '') || E'\n' || r.reason
    from public.push_subscriptions s
    join public.profiles p on p.id = s.user_id
   where p.role = 'owner' and p.is_active;
end $$;
revoke execute on function public.discount_push_targets(uuid) from public, anon;
grant execute on function public.discount_push_targets(uuid) to authenticated;
