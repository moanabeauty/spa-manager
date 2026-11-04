-- Giai đoạn 9 (phần 2): kiểm kho, chuyển kho, chăm sóc lại theo tuần, bài viết, tìm kiếm chung.

-- =====================================================================
-- 4. KHO: kiểm kho (lệch chờ chủ duyệt), chuyển kho, hạn dùng sản phẩm
-- =====================================================================
alter table public.products add column expiry_date date;

create sequence public.stock_count_code_seq;
create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('KK' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMMDD') || '-'
                                     || lpad(nextval('public.stock_count_code_seq')::text, 4, '0')),
  warehouse_id uuid not null references public.warehouses(id),
  status text not null default 'pending' check (status in ('pending','applied','rejected')),
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text
);
create index on public.stock_counts (status);
create table public.stock_count_items (
  count_id uuid not null references public.stock_counts(id) on delete cascade,
  product_id uuid not null references public.products(id),
  system_qty int not null,
  counted_qty int not null check (counted_qty >= 0),
  primary key (count_id, product_id)
);
alter table public.stock_counts enable row level security;
alter table public.stock_count_items enable row level security;
create policy "staff read" on public.stock_counts for select to authenticated using ((select public.is_staff()));
create policy "staff read" on public.stock_count_items for select to authenticated using ((select public.is_staff()));

create or replace function public._apply_stock_count(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c record; v_i record;
begin
  select * into v_c from public.stock_counts where id = p_id;
  for v_i in select * from public.stock_count_items where count_id = p_id and counted_qty <> system_qty loop
    insert into public.stock_movements (warehouse_id, product_id, movement_type, quantity, note)
    values (v_c.warehouse_id, v_i.product_id, 'adjustment', v_i.counted_qty - v_i.system_qty,
            'Kiểm kho ' || v_c.code || coalesce(': ' || v_c.note, ''));
  end loop;
  update public.stock_counts set status = 'applied', reviewed_by = coalesce(reviewed_by, (select auth.uid())),
         reviewed_at = coalesce(reviewed_at, now()) where id = p_id;
end $$;
revoke execute on function public._apply_stock_count(uuid) from public, anon, authenticated;

-- p_items: [{product_id, counted}] — chỉ ghi những sản phẩm đã đếm
create or replace function public.submit_stock_count(p_warehouse_id uuid, p_items jsonb, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_it jsonb; v_qty int; v_cnt int; v_diff int := 0;
begin
  if not public.can_manage_warehouse(p_warehouse_id) then raise exception 'Bạn không có quyền kiểm kho này'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Chưa nhập số đếm sản phẩm nào';
  end if;
  insert into public.stock_counts (warehouse_id, note) values (p_warehouse_id, nullif(trim(p_note), '')) returning id into v_id;
  for v_it in select value from jsonb_array_elements(p_items) loop
    v_cnt := (v_it->>'counted')::int;
    if v_cnt is null or v_cnt < 0 then raise exception 'Số đếm không hợp lệ'; end if;
    select coalesce(sum(quantity), 0) into v_qty from public.stock_movements
     where warehouse_id = p_warehouse_id and product_id = (v_it->>'product_id')::uuid;
    insert into public.stock_count_items (count_id, product_id, system_qty, counted_qty)
    values (v_id, (v_it->>'product_id')::uuid, v_qty, v_cnt)
    on conflict (count_id, product_id) do update set counted_qty = excluded.counted_qty;
    if v_cnt <> v_qty then v_diff := v_diff + 1; end if;
  end loop;
  if v_diff = 0 or public.has_role('owner') then
    perform public._apply_stock_count(v_id);
  elsif nullif(trim(p_note), '') is null then
    raise exception 'Có sản phẩm lệch số: vui lòng ghi lý do (hàng hỏng, vỡ, đếm sai…)';
  end if;
  return v_id;
end $$;
revoke execute on function public.submit_stock_count(uuid, jsonb, text) from public, anon;
grant execute on function public.submit_stock_count(uuid, jsonb, text) to authenticated;

create or replace function public.review_stock_count(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa duyệt chênh lệch kiểm kho'; end if;
  select status into v_status from public.stock_counts where id = p_id for update;
  if not found then raise exception 'Không tìm thấy phiếu kiểm kho'; end if;
  if v_status <> 'pending' then raise exception 'Phiếu đã được xử lý'; end if;
  update public.stock_counts set reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = nullif(trim(p_note), '')
   where id = p_id;
  if p_approve then
    perform public._apply_stock_count(p_id);
  else
    update public.stock_counts set status = 'rejected' where id = p_id;
  end if;
end $$;
revoke execute on function public.review_stock_count(uuid, boolean, text) from public, anon;
grant execute on function public.review_stock_count(uuid, boolean, text) to authenticated;

-- kiểm kê nhanh 1 sản phẩm cũng đi qua phiếu kiểm kho (lệch thì chờ chủ duyệt)
create or replace function public.adjust_stock(p_warehouse_id uuid, p_product_id uuid, p_counted integer, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_qty int;
begin
  if nullif(trim(p_reason), '') is null then raise exception 'Vui lòng ghi lý do điều chỉnh'; end if;
  v_id := public.submit_stock_count(p_warehouse_id, jsonb_build_array(jsonb_build_object('product_id', p_product_id, 'counted', p_counted)), p_reason);
  select counted_qty - system_qty into v_qty from public.stock_count_items where count_id = v_id;
  return v_qty;
end $$;

-- chuyển hàng giữa kho bán lẻ và kho liệu trình của cùng chi nhánh
create or replace function public.transfer_stock(p_from uuid, p_to uuid, p_items jsonb, p_note text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare v_f record; v_t record; v_it jsonb; v_q int; v_n int := 0; v_note text;
begin
  select * into v_f from public.warehouses where id = p_from;
  select * into v_t from public.warehouses where id = p_to;
  if v_f.id is null or v_t.id is null or v_f.id = v_t.id then raise exception 'Chọn kho chuyển và kho nhận khác nhau'; end if;
  if v_f.branch_id <> v_t.branch_id then raise exception 'Chỉ chuyển giữa 2 kho của cùng chi nhánh'; end if;
  if not public.can_manage_warehouse(p_from) then raise exception 'Bạn không có quyền chuyển kho này'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Chưa chọn sản phẩm'; end if;
  v_note := 'Chuyển ' || v_f.name || ' → ' || v_t.name || coalesce(': ' || nullif(trim(p_note), ''), '');
  for v_it in select value from jsonb_array_elements(p_items) loop
    v_q := (v_it->>'quantity')::int;
    if v_q is null or v_q <= 0 then raise exception 'Số lượng chuyển không hợp lệ'; end if;
    insert into public.stock_movements (warehouse_id, product_id, movement_type, quantity, note)
    values (p_from, (v_it->>'product_id')::uuid, 'transfer_out', -v_q, v_note);
    insert into public.stock_movements (warehouse_id, product_id, movement_type, quantity, note)
    values (p_to, (v_it->>'product_id')::uuid, 'transfer_in', v_q, v_note);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.transfer_stock(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.transfer_stock(uuid, uuid, jsonb, text) to authenticated;

-- =====================================================================
-- 5. CHĂM SÓC LẠI: khách chưa quay lại theo số tuần
-- =====================================================================
create or replace function public.care_lapsed(p_branch uuid default null)
returns table (customer_id uuid, full_name text, phone text, last_visit date, days_since int, last_services text,
               last_branch_id uuid, visit_count int, sessions_left int, card_balance numeric, next_appointment timestamptz,
               open_reminder_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
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
  select c.id, c.full_name, c.phone, l.d, (v_today - l.d)::int,
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
end $$;
revoke execute on function public.care_lapsed(uuid) from public, anon;
grant execute on function public.care_lapsed(uuid) to authenticated;

-- =====================================================================
-- 6. BÀI VIẾT CHO KHÁCH: liệu trình mới, góc chăm da
-- =====================================================================
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('new_treatment','skincare')),
  title text not null check (length(trim(title)) > 0),
  slug text not null unique,
  summary text,
  body text not null default '',
  cover_url text,
  service_id uuid references public.services(id) on delete set null,
  is_published boolean not null default false,
  published_at timestamptz,
  created_by uuid references public.profiles(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index on public.posts (kind, is_published, published_at desc);
alter table public.posts enable row level security;
create policy "public read published" on public.posts for select to anon, authenticated
  using (is_published or (select public.has_role('owner','manager')));
create policy "management write" on public.posts for all to authenticated
  using ((select public.has_role('owner','manager'))) with check ((select public.has_role('owner','manager')));

create or replace function public.posts_before_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.is_published and new.published_at is null then new.published_at := now(); end if;
  return new;
end $$;
create trigger posts_bw before insert or update on public.posts for each row execute function public.posts_before_write();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy "post images management insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'post-images' and (select public.has_role('owner','manager')));
create policy "post images management update" on storage.objects for update to authenticated
  using (bucket_id = 'post-images' and (select public.has_role('owner','manager')));
create policy "post images management delete" on storage.objects for delete to authenticated
  using (bucket_id = 'post-images' and (select public.has_role('owner','manager')));

-- =====================================================================
-- 7. TÌM KIẾM CHUNG (khách, SĐT, hoá đơn, mã vận đơn, sản phẩm)
-- =====================================================================
create or replace function public.staff_search(p_q text)
returns table (kind text, id uuid, title text, subtitle text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_digits text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g');
  v_role text := public.my_role()::text;
begin
  if not public.is_staff() then raise exception 'Chỉ nhân viên dùng được tìm kiếm'; end if;
  if v_q is null or length(v_q) < 2 then return; end if;
  if v_digits like '84%' and length(v_digits) = 11 then v_digits := '0' || substr(v_digits, 3); end if;

  if v_role <> 'warehouse' then
    return query
    select 'customer'::text, c.id, c.full_name, c.phone
      from public.customers c
     where c.full_name ilike '%' || v_q || '%'
        or (length(v_digits) >= 3 and c.phone like '%' || v_digits || '%')
     order by c.full_name limit 8;

    return query
    select 'invoice'::text, i.id, i.code,
           concat_ws(' · ', c.full_name, case when i.channel = 'online' then 'Online' end, sh.tracking_code)
      from public.invoices i
      left join public.customers c on c.id = i.customer_id
      left join public.invoice_shipments sh on sh.invoice_id = i.id
     where (i.code ilike '%' || v_q || '%' or sh.tracking_code ilike '%' || v_q || '%')
       and i.status <> 'draft'
       and (v_role in ('owner','manager','receptionist') or public.can_see_invoice(i.id))
     order by i.created_at desc limit 8;
  end if;

  return query
  select 'product'::text, p.id, concat_ws(' ', p.name, p.capacity), concat_ws(' · ', p.brand, p.sku, p.barcode)
    from public.products p
   where p.is_active and (p.name ilike '%' || v_q || '%' or p.sku ilike v_q || '%' or p.barcode = v_q or p.brand ilike '%' || v_q || '%')
   order by p.name limit 8;
end $$;
revoke execute on function public.staff_search(text) from public, anon;
grant execute on function public.staff_search(text) to authenticated;
