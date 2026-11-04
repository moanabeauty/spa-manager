-- Ẩn SĐT khách với KTV (và mọi vai trò không phải chủ / quản lý / lễ tân).
-- Chặn ở tầng cơ sở dữ liệu: cột phone của customers + profiles không còn đọc trực tiếp được qua API.
-- Ai được xem: owner, manager, receptionist; khách xem SĐT của chính mình.
-- Lấy SĐT qua hàm customer_phones(ids) – hàm tự trả null cho người không có quyền.
-- KTV vẫn tìm được khách bằng tên / mã KH / gõ ĐÚNG ĐỦ số điện thoại (không tìm theo vài số).
-- LƯU Ý: thêm cột mới vào customers / profiles thì phải grant select cột đó cho authenticated.

create or replace function public.can_view_customer_phone()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_role('owner','manager','receptionist')
$$;
revoke execute on function public.can_view_customer_phone() from public, anon;
grant execute on function public.can_view_customer_phone() to authenticated;

-- ===== Quyền cột =====
revoke select on public.customers from anon, authenticated;
grant select (id, profile_id, full_name, email, birthday, gender, note, home_branch_id, created_at, code, search_name)
  on public.customers to authenticated;

revoke select on public.profiles from anon, authenticated;
grant select (id, full_name, role, branch_id, is_active, created_at) on public.profiles to authenticated;

-- ===== SĐT theo danh sách id (null nếu không có quyền) =====
create or replace function public.customer_phones(p_ids uuid[])
returns table (id uuid, phone text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.phone from public.customers c
   where c.id = any(p_ids)
     and (public.can_view_customer_phone() or c.profile_id = auth.uid())
$$;
revoke execute on function public.customer_phones(uuid[]) from public, anon;
grant execute on function public.customer_phones(uuid[]) to authenticated;

-- tìm id khách theo SĐT đủ số (dùng nội bộ khi tạo lịch)
create or replace function public._customer_id_by_phone(p_phone text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.customers where phone = public.normalize_phone(p_phone) limit 1
$$;
revoke execute on function public._customer_id_by_phone(text) from public, anon, authenticated;

-- ===== Tạo lịch tại quầy: tra khách theo SĐT qua hàm nội bộ =====
create or replace function public.create_staff_booking(p_branch_id uuid, p_start_at timestamp with time zone, p_source booking_source, p_items jsonb, p_customer_id uuid DEFAULT NULL::uuid, p_customer_name text DEFAULT NULL::text, p_customer_phone text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_customer uuid := p_customer_id;
  v_phone text := public.normalize_phone(p_customer_phone);
  v_appt uuid;
  v_cursor timestamptz := p_start_at;
  v_item jsonb;
  v_dur int;
begin
  if not public.has_role('owner','manager','receptionist','technician') then
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

  if v_customer is null then
    if v_phone is null or length(v_phone) < 9 or length(v_phone) > 11 then
      raise exception 'Số điện thoại không hợp lệ';
    end if;
    v_customer := public._customer_id_by_phone(v_phone);
    if v_customer is null then
      if nullif(trim(p_customer_name), '') is null then
        raise exception 'Vui lòng nhập tên khách mới';
      end if;
      insert into public.customers (full_name, phone, home_branch_id)
      values (trim(p_customer_name), v_phone, p_branch_id)
      returning id into v_customer;
    end if;
  end if;

  insert into public.appointments (customer_id, branch_id, start_at, status, source, note)
  values (v_customer, p_branch_id, p_start_at,
          case when p_source = 'walk_in' then 'in_progress' else 'confirmed' end::public.appointment_status,
          p_source, nullif(trim(p_note), ''))
  returning id into v_appt;

  for v_item in select value from jsonb_array_elements(p_items) loop
    select duration_minutes into v_dur from public.services
     where id = (v_item->>'service_id')::uuid and is_active;
    if v_dur is null then raise exception 'Dịch vụ không tồn tại hoặc đã ngừng'; end if;
    insert into public.appointment_services (appointment_id, service_id, technician_id, start_at, end_at)
    values (v_appt, (v_item->>'service_id')::uuid, nullif(v_item->>'technician_id', '')::uuid,
            v_cursor, v_cursor + make_interval(mins => v_dur));
    v_cursor := v_cursor + make_interval(mins => v_dur);
  end loop;

  update public.appointments set end_at = v_cursor where id = v_appt;
  return v_appt;
end $function$;

-- ===== Tìm khách: KTV chỉ khớp SĐT khi gõ đủ số; SĐT trả về null nếu không có quyền =====
create or replace function public.search_customers(p_q text, p_limit integer DEFAULT 8)
 RETURNS TABLE(id uuid, code text, full_name text, phone text, note text, home_branch_id uuid, packages_left integer, card_balance numeric, last_visit timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_q text := btrim(coalesce(p_q, ''));
  v_fold text := public.vn_fold(btrim(coalesce(p_q, '')));
  v_digits text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g');
  v_code text := upper(regexp_replace(coalesce(p_q, ''), '\s', '', 'g'));
  v_words text[];
  v_see boolean := public.can_view_customer_phone();
  v_min int;
begin
  if not public.is_staff() or public.my_role()::text = 'warehouse' then
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
end $function$;

-- ===== Danh sách khách (CRM) =====
create or replace function public.crm_customers(p_q text DEFAULT NULL::text, p_segment text DEFAULT NULL::text, p_group uuid DEFAULT NULL::uuid, p_branch uuid DEFAULT NULL::uuid, p_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 200)
 RETURNS TABLE(id uuid, full_name text, phone text, email text, birthday date, gender text, home_branch_id uuid, created_at timestamp with time zone, first_visit date, last_visit date, visit_count integer, spent_12m numeric, spent_total numeric, card_balance numeric, sessions_left integer, has_package boolean, has_card boolean, full_menu boolean, segments text[], group_ids uuid[], open_reminders integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_vip numeric := coalesce((public.crm_setting('vip_spend_12m'))::numeric, 30000000);
  v_idle int := coalesce((public.crm_setting('inactive_days'))::int, 60);
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_digits text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g');
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_see boolean := public.can_view_customer_phone();
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
            or (v_see and length(v_digits) >= 3 and length(v_digits) = length(regexp_replace(v_q, '[\s+.-]', '', 'g')) and c.phone like '%' || v_digits || '%')
            or (not v_see and length(v_digits) >= 9 and c.phone = v_digits)
            or c.full_name ilike '%' || v_q || '%'
            or c.search_name like '%' || public.vn_fold(v_q) || '%'
            or c.code = upper(regexp_replace(v_q, '\s', '', 'g')))
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
    select b.id, b.full_name, case when v_see then b.phone end phone, b.email, b.birthday, b.gender, b.home_branch_id, b.created_at,
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
end $function$;

-- ===== Chăm sóc lại =====
create or replace function public.care_lapsed(p_branch uuid DEFAULT NULL::uuid)
 RETURNS TABLE(customer_id uuid, full_name text, phone text, last_visit date, days_since integer, last_services text, last_branch_id uuid, visit_count integer, sessions_left integer, card_balance numeric, next_appointment timestamp with time zone, open_reminder_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
        v_see boolean := public.can_view_customer_phone();
begin
  if not public.has_role('owner','manager','receptionist','technician') then raise exception 'Chỉ nhân viên xem được'; end if;
  return query
  with last_appt as (
    select distinct on (a.customer_id) a.customer_id, a.id, a.branch_id, (a.start_at at time zone 'Asia/Ho_Chi_Minh')::date d
      from public.appointments a
     where a.status = 'completed' and a.customer_id is not null
     order by a.customer_id, a.start_at desc
  ), cnt as (
    select a.customer_id, count(*)::int n from public.appointments a where a.status = 'completed' group by 1
  )
  select c.id, c.full_name, case when v_see then c.phone end, l.d, (v_today - l.d)::int,
         (select string_agg(s.name, ', ' order by aps.start_at) from public.appointment_services aps
            join public.services s on s.id = aps.service_id where aps.appointment_id = l.id and aps.is_active),
         l.branch_id, cnt.n,
         coalesce((select sum(greatest(cpi.total_qty - cpi.used_qty, 0)) from public.customer_packages cp
                     join public.customer_package_items cpi on cpi.customer_package_id = cp.id
                    where cp.customer_id = c.id and cp.is_active and (cp.expires_at is null or cp.expires_at > now())), 0)::int,
         coalesce((select sum(b.balance) from public.service_cards sc join public.service_card_balances b on b.card_id = sc.id
                    where sc.customer_id = c.id and sc.is_active), 0),
         (select min(a.start_at) from public.appointments a
           where a.customer_id = c.id and a.start_at > now() and a.status in ('pending','confirmed')),
         (select r.id from public.care_reminders r where r.customer_id = c.id and r.status = 'open' order by r.due_date limit 1)
    from last_appt l
    join public.customers c on c.id = l.customer_id
    join cnt on cnt.customer_id = c.id
   where v_today - l.d >= 7
     and (p_branch is null or l.branch_id = p_branch)
   order by l.d desc
   limit 2000;
end $function$;
