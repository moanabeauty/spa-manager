-- Giai đoạn 10: phiếu theo dõi da 3 màu + lịch tháng / timeline + giới hạn khách mỗi ca

------------------------------------------------------------------
-- 1. Sức chứa mỗi ca (số khách làm cùng lúc tại 1 chi nhánh)
------------------------------------------------------------------
alter table public.branches add column if not exists max_per_slot int not null default 4
  check (max_per_slot between 1 and 50);

-- Số khách đang làm cùng lúc nhiều nhất trong khoảng [p_from, p_to) tại chi nhánh
create or replace function public.branch_peak_load(p_branch uuid, p_from timestamptz, p_to timestamptz, p_ignore uuid default null)
returns int language sql stable security definer set search_path = '' as $$
  with a as (
    select start_at s, coalesce(end_at, start_at + interval '60 minutes') e
      from public.appointments
     where branch_id = p_branch
       and id is distinct from p_ignore
       and status not in ('cancelled','no_show')
       and start_at < p_to
       and coalesce(end_at, start_at + interval '60 minutes') > p_from
  ), pts as (
    select p_from t
    union select s from a where s > p_from and s < p_to
  )
  select coalesce(max((select count(*) from a where a.s <= pts.t and a.e > pts.t)), 0)::int from pts
$$;
revoke execute on function public.branch_peak_load(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;

create or replace function public.appointments_capacity_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_cap int;
  v_end timestamptz := coalesce(new.end_at, new.start_at + interval '60 minutes');
  v_load int;
begin
  if new.status in ('cancelled','no_show','completed') then return new; end if;
  if tg_op = 'UPDATE'
     and old.status not in ('cancelled','no_show')
     and new.start_at = old.start_at
     and new.branch_id = old.branch_id
     and coalesce(new.end_at, new.start_at) <= coalesce(old.end_at, old.start_at + interval '60 minutes') then
    return new; -- không đổi giờ / không kéo dài: không kiểm tra lại
  end if;
  -- chủ / quản lý được xếp thêm khi đã đủ chỗ
  if public.has_role('owner','manager') then return new; end if;

  select max_per_slot into v_cap from public.branches where id = new.branch_id;
  v_load := public.branch_peak_load(new.branch_id, new.start_at, v_end, new.id);
  if v_load >= coalesce(v_cap, 4) then
    raise exception 'Khung giờ % ngày % đã đủ % khách. Vui lòng chọn giờ khác (chủ / quản lý có thể xếp thêm).',
      to_char(new.start_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI'),
      to_char(new.start_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM'),
      coalesce(v_cap, 4);
  end if;
  return new;
end $$;
revoke execute on function public.appointments_capacity_check() from public, anon, authenticated;
drop trigger if exists appointments_capacity_check on public.appointments;
create trigger appointments_capacity_check before insert or update of start_at, end_at, status, branch_id
  on public.appointments for each row execute function public.appointments_capacity_check();

-- Khoảng giờ đã có khách (không kèm thông tin khách) để khách đặt online thấy giờ còn chỗ
create or replace function public.branch_busy_intervals(p_branch uuid, p_from timestamptz, p_to timestamptz)
returns table (start_at timestamptz, end_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.start_at, coalesce(a.end_at, a.start_at + interval '60 minutes')
    from public.appointments a
   where a.branch_id = p_branch
     and a.status not in ('cancelled','no_show')
     and a.start_at < p_to
     and coalesce(a.end_at, a.start_at + interval '60 minutes') > p_from
     and p_to - p_from <= interval '62 days'
     and (select auth.uid()) is not null
   order by 1
$$;
revoke execute on function public.branch_busy_intervals(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.branch_busy_intervals(uuid, timestamptz, timestamptz) to authenticated;

-- Tổng hợp theo ngày cho lịch tháng: số lịch, số suất 30 phút đã kín / tổng suất (9:00 – 19:30)
create or replace function public.branch_month_load(p_branch uuid, p_from date, p_to date)
returns table (day date, appointments int, full_slots int, slots int, capacity int)
language sql stable security definer set search_path = '' as $$
  with cap as (select coalesce(max_per_slot, 4) c from public.branches where id = p_branch),
  days as (
    select d::date as day from generate_series(p_from, least(p_to, p_from + 62), interval '1 day') d
    where (select auth.uid()) is not null
  ),
  appts as (
    select (a.start_at at time zone 'Asia/Ho_Chi_Minh')::date as day, a.start_at s,
           coalesce(a.end_at, a.start_at + interval '60 minutes') e
      from public.appointments a
     where a.branch_id = p_branch and a.status not in ('cancelled','no_show')
       and a.start_at >= (p_from::timestamp at time zone 'Asia/Ho_Chi_Minh')
       and a.start_at < ((least(p_to, p_from + 62) + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
  ),
  slot as (
    select d.day, ((d.day + time '09:00' + i * interval '30 minutes') at time zone 'Asia/Ho_Chi_Minh') st
      from days d, generate_series(0, 21) i
  )
  select d.day,
         (select count(*) from appts x where x.day = d.day)::int,
         (select count(*) from slot sl
           where sl.day = d.day
             and (select count(*) from appts x where x.s < sl.st + interval '30 minutes' and x.e > sl.st) >= (select c from cap))::int,
         22,
         (select c from cap)
    from days d order by d.day
$$;
revoke execute on function public.branch_month_load(uuid, date, date) from public, anon;
grant execute on function public.branch_month_load(uuid, date, date) to authenticated;

create or replace function public.set_branch_capacity(p_branch uuid, p_cap int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa đổi được số khách mỗi ca'; end if;
  if p_cap is null or p_cap < 1 or p_cap > 50 then raise exception 'Số khách mỗi ca phải từ 1 đến 50'; end if;
  update public.branches set max_per_slot = p_cap where id = p_branch;
end $$;
revoke execute on function public.set_branch_capacity(uuid, int) from public, anon;
grant execute on function public.set_branch_capacity(uuid, int) to authenticated;

------------------------------------------------------------------
-- 2. Phiếu theo dõi da 3 màu (sau mỗi buổi)
--    xanh = da tốt / ổn định, vàng = cần theo dõi / cải thiện, đỏ = có vấn đề, cần xử lý
------------------------------------------------------------------
create table if not exists public.skin_records (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  appointment_id uuid unique references public.appointments(id) on delete set null,
  branch_id uuid references public.branches(id),
  record_date date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  overall text not null check (overall in ('green','yellow','red')),
  criteria jsonb not null default '{}'::jsonb,
  reaction text,          -- phản ứng da sau buổi làm
  customer_needs text,    -- nhu cầu / mong muốn khách nói
  need_tags text[] not null default '{}',
  recommendation text,    -- đề xuất buổi sau / liệu trình
  homecare text,          -- hướng dẫn chăm sóc tại nhà
  next_visit_days int check (next_visit_days between 1 and 365),
  internal_note text,     -- chỉ nhân viên thấy
  technician_id uuid references public.profiles(id) default auth.uid(),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create index if not exists skin_records_customer_idx on public.skin_records (customer_id, record_date desc);

alter table public.skin_records enable row level security;
create policy "skin staff read" on public.skin_records for select to authenticated
  using ((select public.has_role('owner','manager','receptionist','technician')));
create policy "skin staff insert" on public.skin_records for insert to authenticated
  with check ((select public.has_role('owner','manager','receptionist','technician')) and created_by = (select auth.uid()));
create policy "skin author or management update" on public.skin_records for update to authenticated
  using ((select public.has_role('owner','manager')) or (created_by = (select auth.uid()) and (select public.is_staff())))
  with check ((select public.has_role('owner','manager','receptionist','technician')));
create policy "skin management delete" on public.skin_records for delete to authenticated
  using ((select public.has_role('owner','manager')));

create or replace function public.skin_records_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a record; k text; v text;
begin
  if new.appointment_id is not null then
    select customer_id, branch_id, (start_at at time zone 'Asia/Ho_Chi_Minh')::date d
      into a from public.appointments where id = new.appointment_id;
    if a.customer_id is null then raise exception 'Không tìm thấy lịch hẹn'; end if;
    new.customer_id := a.customer_id;
    new.branch_id := coalesce(new.branch_id, a.branch_id);
    if tg_op = 'INSERT' then new.record_date := a.d; end if;
  end if;
  for k, v in select key, value #>> '{}' from jsonb_each(coalesce(new.criteria, '{}'::jsonb)) loop
    if v not in ('green','yellow','red') then raise exception 'Màu không hợp lệ ở mục %', k; end if;
  end loop;
  new.reaction := nullif(trim(new.reaction), '');
  new.customer_needs := nullif(trim(new.customer_needs), '');
  new.recommendation := nullif(trim(new.recommendation), '');
  new.homecare := nullif(trim(new.homecare), '');
  new.internal_note := nullif(trim(new.internal_note), '');
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := (select auth.uid());
    new.updated_at := now();
  end if;
  return new;
end $$;
revoke execute on function public.skin_records_before_write() from public, anon, authenticated;
drop trigger if exists skin_records_biu on public.skin_records;
create trigger skin_records_biu before insert or update on public.skin_records
  for each row execute function public.skin_records_before_write();

-- Phiếu đỏ -> nhắc gọi hỏi thăm hôm sau; có "hẹn quay lại sau N ngày" -> nhắc mời quay lại
create or replace function public.skin_records_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.overall = 'red' then
    insert into public.care_reminders (customer_id, branch_id, kind, title, note, due_date, appointment_id, ref_key)
    values (new.customer_id, new.branch_id, 'followup', 'Da cần theo dõi sát (phiếu da đỏ)',
            coalesce(new.reaction, new.recommendation), new.record_date + 1, new.appointment_id, 'skin:' || new.id)
    on conflict (ref_key) do update set note = excluded.note
      where public.care_reminders.status = 'open';
  else
    delete from public.care_reminders where ref_key = 'skin:' || new.id and status = 'open';
  end if;

  if new.next_visit_days is not null then
    insert into public.care_reminders (customer_id, branch_id, kind, title, note, due_date, appointment_id, ref_key)
    values (new.customer_id, new.branch_id, 'recall', 'Mời quay lại theo đề xuất KTV',
            new.recommendation, new.record_date + new.next_visit_days, new.appointment_id, 'skinrc:' || new.id)
    on conflict (ref_key) do update set due_date = excluded.due_date, note = excluded.note
      where public.care_reminders.status = 'open';
  else
    delete from public.care_reminders where ref_key = 'skinrc:' || new.id and status = 'open';
  end if;
  return new;
end $$;
revoke execute on function public.skin_records_after_write() from public, anon, authenticated;
drop trigger if exists skin_records_aiu on public.skin_records;
create trigger skin_records_aiu after insert or update on public.skin_records
  for each row execute function public.skin_records_after_write();

-- Khách xem phiếu da của mình (không có ghi chú nội bộ / phản ứng da)
create or replace function public.my_skin_records()
returns table (id uuid, record_date date, branch_name text, overall text, criteria jsonb,
               need_tags text[], recommendation text, homecare text, next_visit_days int)
language sql stable security definer set search_path = '' as $$
  select r.id, r.record_date, b.name, r.overall, r.criteria, r.need_tags, r.recommendation, r.homecare, r.next_visit_days
    from public.skin_records r
    left join public.branches b on b.id = r.branch_id
   where r.customer_id = public.my_customer_id()
   order by r.record_date desc, r.created_at desc
   limit 50
$$;
revoke execute on function public.my_skin_records() from public, anon;
grant execute on function public.my_skin_records() to authenticated;
