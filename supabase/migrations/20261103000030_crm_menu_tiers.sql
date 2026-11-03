-- Giai đoạn 8: CRM khách hàng + menu dịch vụ phân cấp

------------------------------------------------------------------
-- 1. Hồ sơ CRM (chỉ nhân viên xem / sửa – khách không đọc được)
------------------------------------------------------------------
create table public.customer_crm (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  address text,
  source text,            -- nguồn khách: Facebook, TikTok, giới thiệu, vãng lai…
  skin_type text,         -- loại da
  skin_concerns text,     -- tình trạng / mong muốn
  health_note text,       -- lưu ý sức khoẻ, dị ứng
  internal_note text,     -- ghi chú nội bộ
  menu_unlocked boolean not null default false, -- chủ / quản lý mở toàn bộ menu thủ công
  updated_by uuid references public.profiles(id) default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.customer_crm enable row level security;
create policy "crm staff read" on public.customer_crm for select to authenticated
  using ((select public.has_role('owner','manager','receptionist','technician')));
create policy "crm staff insert" on public.customer_crm for insert to authenticated
  with check ((select public.has_role('owner','manager','receptionist','technician')));
create policy "crm staff update" on public.customer_crm for update to authenticated
  using ((select public.has_role('owner','manager','receptionist','technician')))
  with check ((select public.has_role('owner','manager','receptionist','technician')));

-- chỉ chủ / quản lý được đổi "mở toàn bộ menu"
create or replace function public.customer_crm_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.menu_unlocked)
     or (tg_op = 'UPDATE' and new.menu_unlocked is distinct from old.menu_unlocked) then
    if not public.has_role('owner','manager') then
      raise exception 'Chỉ chủ spa / quản lý được mở toàn bộ menu cho khách';
    end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.customer_crm_guard() from public, anon, authenticated;
create trigger customer_crm_guard before insert or update on public.customer_crm
  for each row execute function public.customer_crm_guard();

------------------------------------------------------------------
-- 2. Nhóm khách (do chủ / quản lý tạo, nhân viên gắn khách vào)
------------------------------------------------------------------
create table public.customer_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  color text not null default '#DCE3F5',
  description text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create table public.customer_group_members (
  group_id uuid not null references public.customer_groups(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  added_by uuid references public.profiles(id) default auth.uid(),
  added_at timestamptz not null default now(),
  primary key (group_id, customer_id)
);
create index on public.customer_group_members (customer_id);
alter table public.customer_groups enable row level security;
alter table public.customer_group_members enable row level security;
create policy "groups staff read" on public.customer_groups for select to authenticated
  using ((select public.has_role('owner','manager','receptionist','technician')));
create policy "groups management write" on public.customer_groups for all to authenticated
  using ((select public.has_role('owner','manager'))) with check ((select public.has_role('owner','manager')));
create policy "members staff read" on public.customer_group_members for select to authenticated
  using ((select public.has_role('owner','manager','receptionist','technician')));
create policy "members staff insert" on public.customer_group_members for insert to authenticated
  with check ((select public.has_role('owner','manager','receptionist','technician')));
create policy "members staff delete" on public.customer_group_members for delete to authenticated
  using ((select public.has_role('owner','manager','receptionist','technician')));

insert into public.customer_groups (name, color, sort_order) values
  ('Da mụn', '#F6D5D5', 1),
  ('Da nhạy cảm', '#E6DDF5', 2),
  ('Quan tâm trẻ hoá', '#FFE8BA', 3),
  ('Khách giới thiệu', '#D6EDD8', 4);

------------------------------------------------------------------
-- 3. Cài đặt CRM
------------------------------------------------------------------
insert into public.app_settings (key, value) values ('crm', jsonb_build_object(
  'vip_spend_12m', 30000000,      -- chi ≥ 30tr trong 12 tháng = khách VIP
  'inactive_days', 60,            -- quá 60 ngày chưa quay lại
  'birthday_days_before', 7,      -- nhắc chúc sinh nhật trước 7 ngày
  'package_expiry_days', 30,      -- nhắc gói sắp hết hạn trước 30 ngày
  'unlock_menu_by_card', true     -- khách có thẻ nạp sẵn cũng được xem toàn bộ menu
)) on conflict (key) do nothing;

create or replace function public.crm_setting(p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select value -> p_key from public.app_settings where key = 'crm'
$$;
revoke execute on function public.crm_setting(text) from public, anon, authenticated;

create or replace function public.save_crm_settings(p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa sửa được cài đặt'; end if;
  update public.app_settings
     set value = value || jsonb_strip_nulls(jsonb_build_object(
           'vip_spend_12m', (p_value->>'vip_spend_12m')::numeric,
           'inactive_days', (p_value->>'inactive_days')::int,
           'birthday_days_before', (p_value->>'birthday_days_before')::int,
           'package_expiry_days', (p_value->>'package_expiry_days')::int,
           'unlock_menu_by_card', (p_value->>'unlock_menu_by_card')::boolean)),
         updated_by = auth.uid(), updated_at = now()
   where key = 'crm';
end $$;
revoke execute on function public.save_crm_settings(jsonb) from public, anon;
grant execute on function public.save_crm_settings(jsonb) to authenticated;

create or replace function public.crm_settings()
returns jsonb language sql stable security definer set search_path = '' as $$
  select value from public.app_settings where key = 'crm' and public.has_role('owner','manager','receptionist','technician')
$$;
revoke execute on function public.crm_settings() from public, anon;
grant execute on function public.crm_settings() to authenticated;

------------------------------------------------------------------
-- 4. Menu phân cấp
------------------------------------------------------------------
alter table public.services
  add column menu_tier text not null default 'members' check (menu_tier in ('public','members')),
  add column followup_days int check (followup_days between 0 and 60),  -- hỏi thăm sau khi làm X ngày
  add column recall_days int check (recall_days between 1 and 730);     -- mời quay lại sau X ngày
grant select (menu_tier, followup_days, recall_days) on public.services to anon, authenticated;

-- Mặc định: khách mới thấy các nhóm chăm sóc cơ bản / peel / laser / body / tóc / triệt lông;
-- nhóm chuyên sâu (meso, phi kim, RF, HIFU, sẹo, tiêm, filler, botox) chỉ khách đã mua gói.
update public.services s set menu_tier = 'public'
  from public.service_categories c
 where c.id = s.category_id
   and c.name in ('Basic Treatment', 'Basic Treatment – Long Biên', 'Biologique Recherche (Pháp)', 'Chemical Peel',
                  'Light Therapy', 'Body', 'Hair & Scalp', 'Triệt lông', 'Laser');
update public.services set menu_tier = 'public'
 where name in ('Chăm sóc vùng mắt Thermo', 'RF chăm sóc vùng mắt');

-- Nhắc chăm sóc mặc định (sửa được ở Menu dịch vụ → chi tiết)
update public.services s set
  recall_days = case
    when c.name in ('Basic Treatment', 'Basic Treatment – Long Biên', 'Biologique Recherche (Pháp)', 'Hair & Scalp', 'Eyezone') then 14
    when c.name in ('Chemical Peel', 'Light Therapy', 'Laser', 'Body') then 21
    when c.name in ('Mesotherapy / Mesogun', 'Phi kim / Microneedling', 'MNRF – Vi kim RF', 'Acne Scar', 'Triệt lông') then 30
    when c.name in ('BAP – Tiêm trẻ hoá') then 60
    when c.name in ('Botox') then 120
    when c.name in ('MPT / HIFU', 'Filler') then 180
  end,
  followup_days = case
    when c.name in ('Chemical Peel', 'Mesotherapy / Mesogun', 'Phi kim / Microneedling', 'MNRF – Vi kim RF', 'MPT / HIFU',
                    'Acne Scar', 'Laser', 'BAP – Tiêm trẻ hoá', 'Filler', 'Botox', 'Triệt lông') then 1
  end
  from public.service_categories c
 where c.id = s.category_id;
update public.services set recall_days = 14, followup_days = null where name = 'Gội đầu dưỡng sinh Oway';

-- khách đã mua gói combo (kể cả gói khuyến mãi), có thẻ nạp sẵn (nếu bật), hoặc được mở thủ công
create or replace function public.customer_has_full_menu(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_customer is not null and (
    exists (select 1 from public.customer_crm where customer_id = p_customer and menu_unlocked)
    or exists (select 1 from public.customer_packages where customer_id = p_customer)
    or (coalesce((public.crm_setting('unlock_menu_by_card'))::boolean, true)
        and exists (select 1 from public.service_cards where customer_id = p_customer)))
$$;
revoke execute on function public.customer_has_full_menu(uuid) from public, anon, authenticated;

create or replace function public.can_view_full_menu()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_staff() or public.customer_has_full_menu(public.my_customer_id())
$$;
revoke execute on function public.can_view_full_menu() from public;
grant execute on function public.can_view_full_menu() to anon, authenticated;

-- dịch vụ đã có trong lịch của chính khách (để lịch sử vẫn hiện tên dịch vụ)
create or replace function public.my_booked_service_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct aps.service_id
    from public.appointment_services aps
    join public.appointments a on a.id = aps.appointment_id
   where a.customer_id = public.my_customer_id()
$$;
revoke execute on function public.my_booked_service_ids() from public;
grant execute on function public.my_booked_service_ids() to anon, authenticated;

-- policy "public read" (đọc công khai) đổi thành đọc theo cấp
alter policy "public read" on public.services
  using (menu_tier = 'public'
         or (select public.can_view_full_menu())
         or id in (select public.my_booked_service_ids()));

-- số dịch vụ đang ẩn với người xem (để trang menu hiện "còn N dịch vụ dành cho thành viên")
create or replace function public.menu_locked_summary()
returns table (category_id uuid, category_name text, sort_order int, hidden int)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.sort_order, count(*)::int
    from public.services s
    left join public.service_categories c on c.id = s.category_id
   where s.is_active and s.menu_tier = 'members' and not public.can_view_full_menu()
   group by c.id, c.name, c.sort_order
   order by c.sort_order
$$;
revoke execute on function public.menu_locked_summary() from public;
grant execute on function public.menu_locked_summary() to anon, authenticated;

-- khách tự đặt online: không đặt được dịch vụ chưa mở cho mình
create or replace function public.appointment_services_tier_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_tier text; v_customer uuid;
begin
  if public.is_staff() then return new; end if;
  select menu_tier into v_tier from public.services where id = new.service_id;
  if v_tier = 'public' then return new; end if;
  select customer_id into v_customer from public.appointments where id = new.appointment_id;
  if not public.customer_has_full_menu(v_customer) then
    raise exception 'Dịch vụ này dành cho khách đã mua gói tại Moana. Vui lòng liên hệ lễ tân để được tư vấn.';
  end if;
  return new;
end $$;
revoke execute on function public.appointment_services_tier_check() from public, anon, authenticated;
create trigger appointment_services_tier_check before insert on public.appointment_services
  for each row execute function public.appointment_services_tier_check();

-- chủ / quản lý mở (hoặc khoá lại) toàn bộ menu cho 1 khách
create or replace function public.set_customer_menu_unlock(p_customer uuid, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ chủ spa / quản lý được mở toàn bộ menu cho khách'; end if;
  insert into public.customer_crm (customer_id, menu_unlocked) values (p_customer, p_on)
  on conflict (customer_id) do update set menu_unlocked = excluded.menu_unlocked;
end $$;
revoke execute on function public.set_customer_menu_unlock(uuid, boolean) from public, anon;
grant execute on function public.set_customer_menu_unlock(uuid, boolean) to authenticated;

------------------------------------------------------------------
-- 5. Danh sách khách + phân nhóm tự động
------------------------------------------------------------------
create or replace function public.crm_customers(
  p_q text default null, p_segment text default null, p_group uuid default null,
  p_branch uuid default null, p_id uuid default null, p_limit int default 200)
returns table (
  id uuid, full_name text, phone text, email text, birthday date, gender text, home_branch_id uuid, created_at timestamptz,
  first_visit date, last_visit date, visit_count int, spent_12m numeric, spent_total numeric,
  card_balance numeric, sessions_left int, has_package boolean, has_card boolean, full_menu boolean,
  segments text[], group_ids uuid[], open_reminders int)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_vip numeric := coalesce((public.crm_setting('vip_spend_12m'))::numeric, 30000000);
  v_idle int := coalesce((public.crm_setting('inactive_days'))::int, 60);
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_digits text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g');
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if not public.has_role('owner','manager','receptionist','technician') then
    raise exception 'Chỉ nhân viên xem được danh sách khách';
  end if;
  if v_digits like '84%' and length(v_digits) = 11 then v_digits := '0' || substr(v_digits, 3); end if;
  return query
  with base as (
    select c.* from public.customers c
     where (p_id is null or c.id = p_id)
       and (v_q is null
            or (length(v_digits) >= 3 and length(v_digits) = length(regexp_replace(v_q, '[\s+.-]', '', 'g')) and c.phone like '%' || v_digits || '%')
            or c.full_name ilike '%' || v_q || '%')
       and (p_group is null or exists (select 1 from public.customer_group_members m where m.customer_id = c.id and m.group_id = p_group))
       and (p_branch is null or c.home_branch_id = p_branch
            or exists (select 1 from public.appointments a where a.customer_id = c.id and a.branch_id = p_branch))
  ), visits as (
    select a.customer_id, min((a.start_at at time zone 'Asia/Ho_Chi_Minh')::date) f,
           max((a.start_at at time zone 'Asia/Ho_Chi_Minh')::date) l, count(*)::int n
      from public.appointments a join base b on b.id = a.customer_id
     where a.status = 'completed' group by 1
  ), spend as (
    select i.customer_id,
           sum(p.amount) filter (where i.paid_at >= now() - interval '365 days') s12,
           sum(p.amount) st
      from public.invoices i join base b on b.id = i.customer_id
      join public.payments p on p.invoice_id = i.id and p.method <> 'service_card'
     where i.status = 'paid' group by 1
  ), refunded as (
    select r.customer_id,
           sum(r.refund_amount) filter (where r.created_at >= now() - interval '365 days') s12,
           sum(r.refund_amount) st
      from public.refunds r join base b on b.id = r.customer_id group by 1
  ), cards as (
    select sc.customer_id, sum(scb.balance) filter (where sc.is_active) bal, true has
      from public.service_cards sc join base b on b.id = sc.customer_id
      join public.service_card_balances scb on scb.card_id = sc.id group by 1
  ), pk as (
    select cp.customer_id, true has,
           coalesce(sum(greatest(cpi.total_qty - cpi.used_qty, 0)) filter (
             where cp.is_active and (cp.expires_at is null or cp.expires_at > now())), 0)::int lft
      from public.customer_packages cp join base b on b.id = cp.customer_id
      left join public.customer_package_items cpi on cpi.customer_package_id = cp.id
     group by 1
  ), rws as (
    select b.id, b.full_name, b.phone, b.email, b.birthday, b.gender, b.home_branch_id, b.created_at,
           v.f, v.l, coalesce(v.n, 0) n,
           coalesce(sp.s12, 0) - coalesce(rf.s12, 0) s12, coalesce(sp.st, 0) - coalesce(rf.st, 0) st,
           coalesce(cd.bal, 0) bal, coalesce(pk.lft, 0) lft, coalesce(pk.has, false) hp, coalesce(cd.has, false) hc,
           coalesce(crm.menu_unlocked, false) unl,
           (select coalesce(array_agg(m.group_id), '{}') from public.customer_group_members m where m.customer_id = b.id) gids,
           (select count(*)::int from public.care_reminders r where r.customer_id = b.id and r.status = 'open') rem
      from base b
      left join visits v on v.customer_id = b.id
      left join spend sp on sp.customer_id = b.id
      left join refunded rf on rf.customer_id = b.id
      left join cards cd on cd.customer_id = b.id
      left join pk on pk.customer_id = b.id
      left join public.customer_crm crm on crm.customer_id = b.id
  ), tagged as (
    select r.*,
           array_remove(array[
             case when not r.hp and not r.hc and r.n <= 1 then 'moi' end,
             case when r.n >= 2 then 'quay_lai' end,
             case when r.hp or r.hc then 'thanh_vien' end,
             case when r.s12 >= v_vip then 'vip' end,
             case when r.lft > 0 or r.bal > 0 then 'con_buoi' end,
             case when r.l is not null and r.l < v_today - v_idle then 'lau_chua_den' end,
             case when r.birthday is not null and extract(month from r.birthday) = extract(month from v_today) then 'sinh_nhat' end
           ], null) segs
      from rws r
  )
  select t.id, t.full_name, t.phone, t.email, t.birthday, t.gender, t.home_branch_id, t.created_at,
         t.f, t.l, t.n, t.s12, t.st, t.bal, t.lft, t.hp, t.hc,
         (t.unl or t.hp or (t.hc and coalesce((public.crm_setting('unlock_menu_by_card'))::boolean, true))),
         t.segs, t.gids, t.rem
    from tagged t
   where p_segment is null or p_segment = any(t.segs)
   order by t.l desc nulls last, t.created_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 1000));
end $$;
revoke execute on function public.crm_customers(text, text, uuid, uuid, uuid, int) from public, anon;
grant execute on function public.crm_customers(text, text, uuid, uuid, uuid, int) to authenticated;

------------------------------------------------------------------
-- 6. Nhắc chăm sóc lại
------------------------------------------------------------------
create table public.care_reminders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  branch_id uuid references public.branches(id),
  kind text not null check (kind in ('followup','recall','package_expiry','idle','birthday','manual','contact')),
  title text not null,
  note text,
  due_date date not null,
  appointment_id uuid references public.appointments(id) on delete set null,
  ref_key text unique,
  status text not null default 'open' check (status in ('open','done','skipped')),
  result text,
  done_by uuid references public.profiles(id),
  done_at timestamptz,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.care_reminders (status, due_date);
create index on public.care_reminders (customer_id);
alter table public.care_reminders enable row level security;
create policy "care staff read" on public.care_reminders for select to authenticated
  using ((select public.has_role('owner','manager','receptionist','technician')));
-- ghi / sửa chỉ qua các hàm bên dưới

create or replace function public.appointments_care_after_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (new.start_at at time zone 'Asia/Ho_Chi_Minh')::date;
  v_fu int; v_rc int; v_fu_names text; v_rc_names text;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    -- khách đã quay lại: đóng các nhắc "mời quay lại" / "lâu chưa đến" còn mở
    update public.care_reminders
       set status = 'done', result = 'Khách đã quay lại ngày ' || to_char(v_day, 'DD/MM/YYYY'), done_at = now()
     where customer_id = new.customer_id and status = 'open' and kind in ('recall','idle')
       and appointment_id is distinct from new.id;

    select min(s.followup_days), string_agg(distinct s.name, ', ') filter (where s.followup_days is not null),
           min(s.recall_days),   string_agg(distinct s.name, ', ') filter (where s.recall_days is not null)
      into v_fu, v_fu_names, v_rc, v_rc_names
      from public.appointment_services aps join public.services s on s.id = aps.service_id
     where aps.appointment_id = new.id;

    if v_fu is not null then
      insert into public.care_reminders (customer_id, branch_id, kind, title, due_date, appointment_id, ref_key)
      values (new.customer_id, new.branch_id, 'followup', 'Hỏi thăm sau buổi làm: ' || v_fu_names,
              v_day + v_fu, new.id, 'fu:' || new.id)
      on conflict (ref_key) do nothing;
    end if;
    if v_rc is not null then
      insert into public.care_reminders (customer_id, branch_id, kind, title, due_date, appointment_id, ref_key)
      values (new.customer_id, new.branch_id, 'recall', 'Mời quay lại: ' || v_rc_names,
              v_day + v_rc, new.id, 'rc:' || new.id)
      on conflict (ref_key) do nothing;
    end if;
  elsif old.status = 'completed' and new.status <> 'completed' then
    delete from public.care_reminders
     where appointment_id = new.id and status = 'open' and kind in ('followup','recall');
  end if;
  return new;
end $$;
revoke execute on function public.appointments_care_after_status() from public, anon, authenticated;
create trigger appointments_care_after_status after update of status on public.appointments
  for each row execute function public.appointments_care_after_status();

-- tạo nhắc định kỳ: gói sắp hết hạn, lâu chưa quay lại (còn buổi / số dư), sinh nhật. Gọi khi mở trang Chăm sóc.
create or replace function public.refresh_care_reminders()
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_exp int := coalesce((public.crm_setting('package_expiry_days'))::int, 30);
  v_idle int := coalesce((public.crm_setting('inactive_days'))::int, 60);
  v_bd int := coalesce((public.crm_setting('birthday_days_before'))::int, 7);
  v_n int := 0; v_k int;
begin
  if not public.has_role('owner','manager','receptionist','technician') then
    raise exception 'Chỉ nhân viên dùng được';
  end if;

  -- gói combo sắp hết hạn mà còn buổi
  insert into public.care_reminders (customer_id, branch_id, kind, title, due_date, ref_key)
  select cp.customer_id, coalesce(c.home_branch_id, i.branch_id), 'package_expiry',
         'Gói ' || p.name || ' hết hạn ' || to_char((cp.expires_at at time zone 'Asia/Ho_Chi_Minh')::date, 'DD/MM/YYYY')
           || ', còn ' || x.lft || ' buổi',
         v_today, 'pkx:' || cp.id
    from public.customer_packages cp
    join public.packages p on p.id = cp.package_id
    join public.customers c on c.id = cp.customer_id
    left join public.invoice_items ii on ii.id = cp.invoice_item_id
    left join public.invoices i on i.id = ii.invoice_id
    join lateral (select sum(greatest(total_qty - used_qty, 0))::int lft from public.customer_package_items
                   where customer_package_id = cp.id) x on x.lft > 0
   where cp.is_active and cp.expires_at is not null
     and cp.expires_at > now() and cp.expires_at <= now() + make_interval(days => v_exp)
  on conflict (ref_key) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  -- lâu chưa quay lại nhưng còn buổi gói / số dư thẻ
  insert into public.care_reminders (customer_id, branch_id, kind, title, due_date, ref_key)
  select c.id, coalesce(c.home_branch_id, lv.branch_id), 'idle',
         'Lâu chưa quay lại (lần cuối ' || to_char(lv.d, 'DD/MM/YYYY') || ')'
           || case when coalesce(pk.lft, 0) > 0 then ' – còn ' || pk.lft || ' buổi gói' else '' end
           || case when coalesce(cb.bal, 0) > 0 then ' – thẻ còn ' || to_char(cb.bal, 'FM999G999G999G999') || 'đ' else '' end,
         v_today, 'idle:' || c.id || ':' || lv.d
    from public.customers c
    join lateral (select (a.start_at at time zone 'Asia/Ho_Chi_Minh')::date d, a.branch_id from public.appointments a
                   where a.customer_id = c.id and a.status = 'completed' order by a.start_at desc limit 1) lv on true
    left join lateral (select sum(greatest(i.total_qty - i.used_qty, 0))::int lft
                         from public.customer_packages cp join public.customer_package_items i on i.customer_package_id = cp.id
                        where cp.customer_id = c.id and cp.is_active and (cp.expires_at is null or cp.expires_at > now())) pk on true
    left join lateral (select sum(b.balance) bal from public.service_cards sc join public.service_card_balances b on b.card_id = sc.id
                        where sc.customer_id = c.id and sc.is_active) cb on true
   where lv.d < v_today - v_idle and (coalesce(pk.lft, 0) > 0 or coalesce(cb.bal, 0) > 0)
  on conflict (ref_key) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  -- sinh nhật sắp tới
  insert into public.care_reminders (customer_id, branch_id, kind, title, due_date, ref_key)
  select c.id, c.home_branch_id, 'birthday', 'Sinh nhật ' || to_char(nb.d, 'DD/MM') || ' – gửi lời chúc / ưu đãi',
         v_today, 'bd:' || c.id || ':' || extract(year from nb.d)
    from public.customers c
    join lateral (select case when x < v_today then (c.birthday + make_interval(years => extract(year from v_today)::int + 1 - extract(year from c.birthday)::int))::date
                              else x end d
                    from (select (c.birthday + make_interval(years => extract(year from v_today)::int - extract(year from c.birthday)::int))::date x) y) nb on true
   where c.birthday is not null and nb.d between v_today and v_today + v_bd
  on conflict (ref_key) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  return v_n;
end $$;
revoke execute on function public.refresh_care_reminders() from public, anon;
grant execute on function public.refresh_care_reminders() to authenticated;

-- nhân viên thêm nhắc thủ công, hoặc ghi lại 1 lần liên hệ đã xong (p_done)
create or replace function public.add_care_reminder(p_customer uuid, p_due date, p_title text, p_note text default null, p_done boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_branch uuid;
begin
  if not public.has_role('owner','manager','receptionist','technician') then raise exception 'Chỉ nhân viên dùng được'; end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then raise exception 'Vui lòng nhập nội dung'; end if;
  select coalesce(c.home_branch_id, (select branch_id from public.profiles where id = auth.uid()))
    into v_branch from public.customers c where c.id = p_customer;
  if not found then raise exception 'Không tìm thấy khách'; end if;
  insert into public.care_reminders (customer_id, branch_id, kind, title, note, due_date, status, result, done_by, done_at)
  values (p_customer, v_branch, case when p_done then 'contact' else 'manual' end, btrim(p_title), nullif(btrim(coalesce(p_note, '')), ''),
          coalesce(p_due, (now() at time zone 'Asia/Ho_Chi_Minh')::date),
          case when p_done then 'done' else 'open' end,
          case when p_done then nullif(btrim(coalesce(p_note, '')), '') end,
          case when p_done then auth.uid() end, case when p_done then now() end)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.add_care_reminder(uuid, date, text, text, boolean) from public, anon;
grant execute on function public.add_care_reminder(uuid, date, text, text, boolean) to authenticated;

-- xong / bỏ qua 1 nhắc; p_next_days: hẹn gọi lại sau N ngày
create or replace function public.complete_care_reminder(p_id uuid, p_status text, p_result text default null, p_next_days int default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.care_reminders;
begin
  if not public.has_role('owner','manager','receptionist','technician') then raise exception 'Chỉ nhân viên dùng được'; end if;
  if p_status not in ('done','skipped','open') then raise exception 'Trạng thái không hợp lệ'; end if;
  if p_status = 'skipped' and nullif(btrim(coalesce(p_result, '')), '') is null then raise exception 'Bỏ qua cần ghi lý do'; end if;
  select * into r from public.care_reminders where id = p_id for update;
  if not found then raise exception 'Không tìm thấy nhắc'; end if;
  update public.care_reminders
     set status = p_status,
         result = case when p_status = 'open' then null else nullif(btrim(coalesce(p_result, '')), '') end,
         done_by = case when p_status = 'open' then null else auth.uid() end,
         done_at = case when p_status = 'open' then null else now() end
   where id = p_id;
  if p_next_days is not null and p_next_days > 0 and p_status <> 'open' then
    insert into public.care_reminders (customer_id, branch_id, kind, title, note, due_date)
    values (r.customer_id, r.branch_id, 'manual', 'Gọi lại: ' || regexp_replace(r.title, '^Gọi lại: ', ''),
            nullif(btrim(coalesce(p_result, '')), ''),
            (now() at time zone 'Asia/Ho_Chi_Minh')::date + p_next_days);
  end if;
end $$;
revoke execute on function public.complete_care_reminder(uuid, text, text, int) from public, anon;
grant execute on function public.complete_care_reminder(uuid, text, text, int) to authenticated;
