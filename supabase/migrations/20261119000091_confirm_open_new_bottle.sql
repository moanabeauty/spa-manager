-- XÁC NHẬN CÒN HÀNG → thêm phương án "DUYỆT MỞ LỌ MỚI" (chủ spa / quản lý)
--   KTV chưa hoàn thành được buổi vì chai đang mở không đủ → gửi "Xin chủ spa xác nhận còn hàng".
--   Ngoài "Xác nhận còn hàng" (chủ chọn mức còn của chai thực tế), chủ / quản lý được:
--   tìm 1 sản phẩm CÒN TỒN trong kho liệu trình của chi nhánh → xuất 1 chai / lọ mới (100%) → thành chai đang mở.
--   - Cùng sản phẩm: chỉ mở lọ mới.
--   - Sản phẩm khác: buổi này đổi sang sản phẩm mới (cùng định lượng), ghi vào điều chỉnh quy trình (đã duyệt).
--   Cost: lọ mới mang giá nhập của lô xuất ra (FIFO – giá nhập mới), lượng trừ buổi này tính theo sản phẩm mới.
--   Chủ thấy giá nhập + cost buổi; quản lý KHÔNG thấy cost.

alter table public.usage_stock_confirms
  add column if not exists resolution text,                                   -- 'confirm' | 'new_bottle'
  add column if not exists new_product_id uuid references public.products(id),
  add column if not exists movement_id uuid references public.stock_movements(id);
alter table public.usage_stock_confirms drop constraint if exists usage_stock_confirms_resolution_check;
alter table public.usage_stock_confirms add constraint usage_stock_confirms_resolution_check
  check (resolution is null or resolution in ('confirm','new_bottle'));
update public.usage_stock_confirms set resolution = 'confirm' where status = 'approved' and resolution is null;

alter table public.opened_items drop constraint if exists opened_items_source_check;
alter table public.opened_items add constraint opened_items_source_check
  check (source in ('opening','request','confirm','new_bottle'));

-- ===== Giá nhập của chai tiếp theo xuất ra (FIFO: lô nhập cũ nhất còn hàng; hết hàng → giá nhập lần cuối) =====
create or replace function public._fifo_next_cost(p_product uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  with p as (select id, cost_price from public.products where id = p_product),
  outs as (
    select coalesce(sum(-m.quantity), 0)::numeric o from public.stock_movements m
     where m.product_id = p_product and m.quantity < 0 and m.movement_type::text <> 'transfer_out'
  ),
  lots as (
    select m.created_at, m.id, m.quantity::numeric q, coalesce(m.unit_cost, p.cost_price) c,
           sum(m.quantity) over (order by m.created_at, m.id)::numeric cum
      from public.stock_movements m, p
     where m.product_id = p_product and m.quantity > 0 and m.movement_type::text <> 'transfer_in'
  )
  select coalesce(
    (select l.c from lots l, outs where l.cum - outs.o > 0 order by l.created_at, l.id limit 1),
    (select cost_price from p))
$$;
revoke execute on function public._fifo_next_cost(uuid) from public, anon, authenticated;

-- ===== Dòng định mức của buổi đang dùng sản phẩm bị thiếu =====
create or replace function public._confirm_items(p_aps uuid, p_product uuid)
returns table (item_id uuid, step_no int, product_name text, qty numeric)
language sql stable security definer set search_path = '' as $$
  select n.item_id, n.step_no, n.product_name, n.qty
    from public._session_needs(p_aps, '{}'::jsonb) n
   where n.product_id = p_product or p_product = any(n.alt_ids)
$$;
revoke execute on function public._confirm_items(uuid, uuid) from public, anon, authenticated;

-- ===== Sản phẩm thay đã duyệt cũng áp dụng cho sản phẩm KTV xin thêm (add_product / add_step) =====
create or replace function public._session_needs(p_aps uuid, p_choices jsonb default '{}'::jsonb)
returns table (item_id uuid, step_no int, product_name text, product_id uuid, qty numeric, alt_ids uuid[], changed boolean)
language sql stable security definer set search_path = '' as $$
  with a as (select * from public.appointment_services where id = p_aps),
  ch as (select * from public.procedure_change_requests c where c.appointment_service_id = p_aps and c.status = 'approved'),
  base as (
    select i.*,
           (select c.to_product_id from ch c
             where c.kind = 'swap' and (c.item_id = i.id
                   or (c.item_id is null and c.step_no = i.step_no and public._norm_name(c.from_product) = public._norm_name(i.product_name)))
             order by c.reviewed_at desc nulls last limit 1) swap_pid,
           exists (select 1 from ch c
             where c.kind = 'swap' and (c.item_id = i.id
                   or (c.item_id is null and c.step_no = i.step_no and public._norm_name(c.from_product) = public._norm_name(i.product_name)))) swapped,
           (select c.new_qty from ch c where c.kind in ('qty','swap') and c.new_qty is not null and c.item_id = i.id
             order by c.reviewed_at desc nulls last limit 1) qty2,
           exists (select 1 from ch c where (c.kind = 'remove' and c.item_id = i.id)
                                         or (c.kind = 'remove_step' and c.parent_id is null and c.step_no = i.step_no)) removed
      from public.service_step_items i, a
     where i.service_id = a.service_id
  ),
  added as (
    select c.id, c.step_no,
           coalesce(sw.label, c.product_label, c.to_product) to_product,
           coalesce(sw.pid, c.to_product_id) to_product_id,
           coalesce((select q.new_qty from ch q where q.kind in ('qty','swap') and q.item_id = c.id and q.new_qty is not null
                      order by q.reviewed_at desc nulls last limit 1), c.new_qty) qty
      from ch c
      left join lateral (select s.to_product_id pid, coalesce(s.product_label, s.to_product) label from ch s
                          where s.kind = 'swap' and s.item_id = c.id and s.to_product_id is not null
                          order by s.reviewed_at desc nulls last limit 1) sw on true
     where c.kind in ('add_product','add_step') and coalesce(sw.pid, c.to_product_id) is not null
       and not exists (select 1 from ch r where r.kind = 'remove' and (r.item_id = c.id or r.item_id = c.parent_id))
       and (c.parent_id is null or exists (select 1 from ch p where p.id = c.parent_id))
       and not (c.kind = 'add_product' and c.parent_id is null
                and exists (select 1 from ch r where r.kind = 'remove_step' and r.parent_id is null and r.step_no = c.step_no))
  )
  select b.id, b.step_no, b.product_name,
         case when b.swapped then b.swap_pid
              when nullif(p_choices->>(b.id::text), '') is not null
                   and (p_choices->>(b.id::text))::uuid = any(b.alt_product_ids || b.product_id)
                then (p_choices->>(b.id::text))::uuid
              else b.product_id end,
         coalesce(b.qty2, b.qty), b.alt_product_ids, (b.swapped or b.qty2 is not null)
    from base b
   where not b.removed
     and coalesce(b.qty2, b.qty) is not null
     and (case when b.swapped then b.swap_pid else b.product_id end) is not null
  union all
  select d.id, d.step_no, d.to_product, d.to_product_id, d.qty, '{}'::uuid[], true
    from added d where d.qty is not null
$$;
revoke execute on function public._session_needs(uuid, jsonb) from public, anon, authenticated;

-- ===== Tìm sản phẩm còn tồn trong kho liệu trình của chi nhánh để mở lọ mới =====
-- Chủ spa: kèm giá nhập (lô xuất tiếp theo) + cost buổi này với sản phẩm đó. Quản lý: cost để trống.
create or replace function public.confirm_bottle_options(p_id uuid, p_q text default null)
returns table (product_id uuid, label text, sku text, unit text, stock numeric, same boolean,
               need numeric, unit_cost numeric, session_cost numeric, current_cost numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.usage_stock_confirms; v_need numeric; v_cur numeric; v_owner boolean := public.has_role('owner');
  v_q text := nullif(trim(p_q), '');
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ chủ spa / quản lý'; end if;
  select * into v from public.usage_stock_confirms where id = p_id;
  if not found then raise exception 'Không tìm thấy yêu cầu'; end if;
  select coalesce(sum(i.qty), 0) into v_need from public._confirm_items(v.appointment_service_id, v.product_id) i;
  if v_owner then
    select case when public.is_single_use_product(p.unit, p.volume) then round(v_need * c)
                when p.volume > 0 then round(v_need / p.volume * c) end
      into v_cur
      from public.products p, lateral (select public._fifo_next_cost(p.id) c) x where p.id = v.product_id;
  end if;
  return query
  with s as (
    select m.product_id, sum(m.quantity)::numeric q from public.stock_movements m
     where m.warehouse_id = v.warehouse_id group by m.product_id having sum(m.quantity) > 0
  )
  select p.id, concat_ws(' · ', p.name, p.capacity), p.sku, public.volume_unit(p.capacity, p.unit), s.q,
         p.id = v.product_id, v_need,
         case when v_owner then public._fifo_next_cost(p.id) end,
         case when v_owner and p.volume > 0 then round(v_need / p.volume * public._fifo_next_cost(p.id)) end,
         v_cur
    from s join public.products p on p.id = s.product_id
   where p.deleted_at is null
     and not public.is_single_use_product(p.unit, p.volume)
     and (v_q is null or p.id = v.product_id
          or p.name ilike '%' || v_q || '%' or p.brand ilike '%' || v_q || '%'
          or p.sku ilike v_q || '%' or p.barcode ilike '%' || v_q || '%')
   order by (p.id = v.product_id) desc, p.name
   limit 20;
end $$;
revoke execute on function public.confirm_bottle_options(uuid, text) from public, anon;
grant execute on function public.confirm_bottle_options(uuid, text) to authenticated;

-- ===== Duyệt mở lọ mới =====
create or replace function public.approve_open_new_bottle(p_id uuid, p_product uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.usage_stock_confirms; s public.appointment_services;
  p public.products; v_old text; v_new text; v_mid uuid; v_cost int; v_oid uuid; r record; v_n int := 0;
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ chủ spa / quản lý duyệt mở lọ mới'; end if;
  select * into v from public.usage_stock_confirms where id = p_id for update;
  if not found or v.status <> 'pending' then raise exception 'Yêu cầu đã được xử lý'; end if;
  select * into s from public.appointment_services where id = v.appointment_service_id;
  if s.work_done_at is not null then raise exception 'Buổi đã hoàn thành – không cần mở lọ mới nữa'; end if;
  select * into p from public.products where id = p_product and deleted_at is null;
  if not found then raise exception 'Không tìm thấy sản phẩm'; end if;
  if public.is_single_use_product(p.unit, p.volume) then
    raise exception 'Sản phẩm dùng 1 lần không mở lọ được – chọn sản phẩm dạng chai / lọ / hũ';
  end if;
  if p.volume is null or p.volume <= 0 then
    raise exception 'Sản phẩm "%" chưa có dung tích – nhờ kho bổ sung dung tích trước', p.name;
  end if;

  -- xuất 1 chai / lọ khỏi kho (kiểm tra tồn + ghi giá vốn FIFO tự động)
  insert into public.stock_movements (warehouse_id, product_id, movement_type, quantity, note)
  values (v.warehouse_id, p.id, 'export_use', -1, 'Duyệt mở lọ mới cho buổi liệu trình (xác nhận còn hàng)')
  returning id, unit_cost into v_mid, v_cost;

  insert into public.opened_items (warehouse_id, product_id, remaining_pct, source, unit_cost, opened_by)
  values (v.warehouse_id, p.id, 100, 'new_bottle', v_cost, (select auth.uid()))
  returning id into v_oid;

  select concat_ws(' · ', name, capacity) into v_old from public.products where id = v.product_id;
  v_new := concat_ws(' · ', p.name, p.capacity);

  -- sản phẩm khác → buổi này dùng sản phẩm mới, cùng định lượng (điều chỉnh quy trình đã duyệt)
  if p.id <> v.product_id then
    for r in select * from public._confirm_items(v.appointment_service_id, v.product_id) loop
      insert into public.procedure_change_requests
        (appointment_service_id, step_no, from_product, to_product, to_product_id, reason, requested_by,
         kind, item_id, product_label, status, reviewed_by, reviewed_at, review_note)
      values (v.appointment_service_id, r.step_no, r.product_name,
              v_new || ' · ' || trim(to_char(r.qty, 'FM999999990.###')) || ' ' || public.volume_unit(p.capacity, p.unit),
              p.id, 'Hết ' || coalesce(v_old, 'sản phẩm') || ' – duyệt mở lọ mới sản phẩm thay thế', (select auth.uid()),
              'swap', r.item_id, v_new, 'approved', (select auth.uid()), now(), nullif(trim(p_note), ''));
      v_n := v_n + 1;
    end loop;
  end if;

  update public.usage_stock_confirms
     set status = 'approved', resolution = 'new_bottle', new_product_id = p.id, movement_id = v_mid,
         remaining_pct = 100, opened_item_id = v_oid,
         reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = nullif(trim(p_note), '')
   where id = p_id;

  perform public.notify_users(array[v.requested_by], 'result',
    'Đã duyệt mở lọ mới',
    concat_ws(' · ', case when p.id = v.product_id then v_new else v_old || ' → ' || v_new end, nullif(trim(p_note), '')),
    '/quan-ly/ktv/lieu-trinh/' || v.appointment_service_id, 'confirm-r-' || v.id);
end $$;
revoke execute on function public.approve_open_new_bottle(uuid, uuid, text) from public, anon;
grant execute on function public.approve_open_new_bottle(uuid, uuid, text) to authenticated;

-- ===== Xác nhận còn hàng (chủ) / Không duyệt (chủ hoặc quản lý) =====
create or replace function public.review_stock_confirm(p_id uuid, p_approve boolean, p_pct numeric default null, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.usage_stock_confirms; v_oid uuid; v_label text;
begin
  if p_approve and not public.has_role('owner') then raise exception 'Chỉ chủ spa xác nhận còn hàng'; end if;
  if not p_approve and not public.has_role('owner','manager') then raise exception 'Chỉ chủ spa / quản lý'; end if;
  select * into v from public.usage_stock_confirms where id = p_id for update;
  if not found or v.status <> 'pending' then raise exception 'Yêu cầu đã được xử lý'; end if;
  if p_approve then
    if p_pct is null or p_pct <= 0 or p_pct > 100 then raise exception 'Chọn mức còn của chai'; end if;
    insert into public.opened_items (warehouse_id, product_id, remaining_pct, source, unit_cost, opened_by)
    select v.warehouse_id, v.product_id, p_pct, 'confirm', round(coalesce(p.cost_price, 0) * p_pct / 100), v.requested_by
      from public.products p where p.id = v.product_id
    returning id into v_oid;
  end if;
  update public.usage_stock_confirms
     set status = case when p_approve then 'approved' else 'rejected' end,
         resolution = case when p_approve then 'confirm' end,
         remaining_pct = case when p_approve then p_pct end, opened_item_id = v_oid,
         reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = nullif(trim(p_note), '')
   where id = p_id;
  select concat_ws(' · ', name, capacity) into v_label from public.products where id = v.product_id;
  perform public.notify_users(array[v.requested_by], 'result',
    case when p_approve then 'Chủ spa xác nhận còn hàng' else 'Chưa duyệt còn hàng / mở lọ mới' end,
    concat_ws(' · ', v_label, nullif(trim(p_note), '')),
    '/quan-ly/ktv/lieu-trinh/' || v.appointment_service_id, 'confirm-r-' || v.id);
end $$;
revoke execute on function public.review_stock_confirm(uuid, boolean, numeric, text) from public, anon;
grant execute on function public.review_stock_confirm(uuid, boolean, numeric, text) to authenticated;

-- ===== KTV gửi xin: báo cả chủ spa và quản lý chi nhánh =====
create or replace function public.request_stock_confirm(p_aps uuid, p_product uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_wh uuid := public._session_warehouse(p_aps); v_label text; v_cus text; v_branch uuid;
begin
  if not exists (select 1 from public.appointment_services
                  where id = p_aps and (technician_id = (select auth.uid()) or public.has_role('owner','manager'))) then
    raise exception 'Dịch vụ này không phải của bạn';
  end if;
  if v_wh is null then raise exception 'Chi nhánh chưa có kho liệu trình'; end if;
  if exists (select 1 from public.usage_stock_confirms where appointment_service_id = p_aps and product_id = p_product and status = 'pending') then
    raise exception 'Đã gửi xin xác nhận sản phẩm này, đang chờ chủ spa / quản lý duyệt';
  end if;
  insert into public.usage_stock_confirms (appointment_service_id, warehouse_id, product_id, note)
  values (p_aps, v_wh, p_product, nullif(trim(p_note), '')) returning id into v_id;
  select concat_ws(' · ', name, capacity) into v_label from public.products where id = p_product;
  select c.full_name into v_cus from public.appointment_services s join public.appointments a on a.id = s.appointment_id
    join public.customers c on c.id = a.customer_id where s.id = p_aps;
  select branch_id into v_branch from public.warehouses where id = v_wh;
  perform public.notify_users(
    public.staff_recipients(array['owner']::public.user_role[], null)
      || public.staff_recipients(array['manager']::public.user_role[], v_branch),
    'approval', 'Xác nhận còn hàng / mở lọ mới cần duyệt',
    concat_ws(' · ', (select full_name from public.profiles where id = (select auth.uid())), v_label, 'khách ' || v_cus),
    '/quan-ly/cho-duyet#con-hang', 'confirm-' || v_id);
  return v_id;
end $$;
revoke execute on function public.request_stock_confirm(uuid, uuid, text) from public, anon;
grant execute on function public.request_stock_confirm(uuid, uuid, text) to authenticated;
