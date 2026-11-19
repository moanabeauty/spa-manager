-- KTV điều chỉnh quy trình từng buổi (cần chủ / quản lý duyệt):
--   swap = đổi sản phẩm · remove = bỏ sản phẩm · qty = đổi định lượng
--   add_product = thêm sản phẩm · remove_step = bỏ cả bước · add_step = thêm bước
-- Sau khi duyệt, lượng trừ kho khi Hoàn thành buổi tính theo quy trình đã điều chỉnh.

alter table public.procedure_change_requests
  add column if not exists kind text not null default 'swap',
  add column if not exists item_id uuid,          -- dòng định mức (service_step_items.id) hoặc id yêu cầu thêm SP / thêm bước đã duyệt
  add column if not exists new_qty numeric(12,3),
  add column if not exists step_title text,
  add column if not exists product_label text,   -- tên sản phẩm chọn (đổi / thêm), không kèm định lượng
  add column if not exists parent_id uuid references public.procedure_change_requests(id) on delete cascade;
alter table public.procedure_change_requests drop constraint if exists procedure_change_requests_kind_check;
alter table public.procedure_change_requests add constraint procedure_change_requests_kind_check
  check (kind in ('swap','remove','qty','add_product','remove_step','add_step'));
alter table public.procedure_change_requests drop constraint if exists procedure_change_requests_new_qty_check;
alter table public.procedure_change_requests add constraint procedure_change_requests_new_qty_check
  check (new_qty is null or new_qty > 0);
alter table public.procedure_change_requests drop constraint if exists procedure_change_requests_status_check;
alter table public.procedure_change_requests add constraint procedure_change_requests_status_check
  check (status in ('pending','approved','rejected','cancelled'));
-- KTV xem được mọi điều chỉnh của buổi mình làm (kể cả do quản lý gửi)
drop policy if exists "own or management read" on public.procedure_change_requests;
create policy "own or management read" on public.procedure_change_requests for select
  using (requested_by = (select auth.uid()) or (select public.has_role('owner','manager'))
         or exists (select 1 from public.appointment_services s
                     where s.id = appointment_service_id and s.technician_id = (select auth.uid())));

-- ===== Sản phẩm cần trừ cho 1 buổi (theo quy trình gốc + các điều chỉnh đã duyệt) =====
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
    select c.id, c.step_no, coalesce(c.product_label, c.to_product) to_product, c.to_product_id,
           coalesce((select q.new_qty from ch q where q.kind = 'qty' and q.item_id = c.id and q.new_qty is not null
                      order by q.reviewed_at desc nulls last limit 1), c.new_qty) qty
      from ch c
     where c.kind in ('add_product','add_step') and c.to_product_id is not null
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

-- ===== KTV gửi yêu cầu điều chỉnh =====
create or replace function public.request_procedure_adjust(
  p_aps uuid, p_kind text, p_step int, p_reason text,
  p_item uuid default null, p_parent uuid default null,
  p_to text default null, p_to_product uuid default null,
  p_qty numeric default null, p_title text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v public.appointment_services;
  v_id uuid; v_pid uuid := p_to_product;
  v_from text; v_to text; v_item_name text; v_item_qty numeric; v_item_pid uuid;
  v_unit text; v_step_title text; v_parent public.procedure_change_requests;
begin
  select * into v from public.appointment_services where id = p_aps;
  if not found or (v.technician_id is distinct from (select auth.uid()) and not public.has_role('owner','manager')) then
    raise exception 'Dịch vụ này không phải của bạn';
  end if;
  if v.work_done_at is not null then raise exception 'Buổi đã hoàn thành, không điều chỉnh quy trình được nữa'; end if;
  if p_kind not in ('swap','remove','qty','add_product','remove_step','add_step') then raise exception 'Loại điều chỉnh không hợp lệ'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Vui lòng ghi lý do'; end if;
  if p_qty is not null and p_qty <= 0 then raise exception 'Định lượng phải lớn hơn 0'; end if;

  if p_parent is not null then
    select * into v_parent from public.procedure_change_requests
     where id = p_parent and appointment_service_id = p_aps and kind = 'add_step' and status in ('pending','approved');
    if not found then raise exception 'Không tìm thấy bước thêm'; end if;
  end if;

  -- sản phẩm gõ tay: thử tìm đúng tên trong kho
  if v_pid is null and nullif(trim(p_to), '') is not null then
    select id into v_pid from public.products
     where deleted_at is null and public._norm_name(name) = public._norm_name(p_to)
     order by for_retail, is_active desc limit 1;
  end if;
  if v_pid is not null then
    select public.volume_unit(capacity, unit) into v_unit from public.products where id = v_pid;
  end if;

  -- dòng sản phẩm đang điều chỉnh: định mức gốc hoặc sản phẩm đã xin thêm
  if p_item is not null then
    select i.product_name, i.qty, i.product_id into v_item_name, v_item_qty, v_item_pid
      from public.service_step_items i where i.id = p_item and i.service_id = v.service_id;
    if not found then
      select coalesce(c.product_label, c.to_product), c.new_qty, c.to_product_id into v_item_name, v_item_qty, v_item_pid
        from public.procedure_change_requests c
       where c.id = p_item and c.appointment_service_id = p_aps and c.kind in ('add_product','add_step')
         and c.status in ('pending','approved');
      if not found then raise exception 'Không tìm thấy sản phẩm trong quy trình'; end if;
    end if;
    if v_unit is null and v_item_pid is not null then
      select public.volume_unit(capacity, unit) into v_unit from public.products where id = v_item_pid;
    end if;
  end if;
  select title into v_step_title from public.service_procedure_steps where service_id = v.service_id and step_no = p_step;

  if p_kind = 'swap' then
    if nullif(trim(p_to), '') is null then raise exception 'Vui lòng chọn sản phẩm muốn dùng'; end if;
    v_from := coalesce(v_item_name, '?');
    v_to := trim(p_to) || coalesce(' · ' || trim(to_char(p_qty, 'FM999999990.###')) || ' ' || coalesce(v_unit, ''), '');
  elsif p_kind = 'remove' then
    if p_item is null then raise exception 'Chọn sản phẩm muốn bỏ'; end if;
    v_from := v_item_name; v_to := 'Bỏ – không dùng';
  elsif p_kind = 'qty' then
    if p_item is null or p_qty is null then raise exception 'Nhập định lượng mới'; end if;
    v_from := v_item_name || coalesce(' · ' || trim(to_char(v_item_qty, 'FM999999990.###')) || ' ' || coalesce(v_unit, ''), '');
    v_to := 'Định lượng mới ' || trim(to_char(p_qty, 'FM999999990.###')) || ' ' || coalesce(v_unit, '');
  elsif p_kind = 'add_product' then
    if nullif(trim(p_to), '') is null then raise exception 'Vui lòng chọn sản phẩm muốn thêm'; end if;
    if v_pid is not null and p_qty is null then raise exception 'Nhập định lượng cho sản phẩm thêm'; end if;
    v_from := 'Thêm sản phẩm vào ' || case when p_parent is not null then 'bước thêm "' || v_parent.step_title || '"'
                                           else 'bước ' || p_step || coalesce('. ' || v_step_title, '') end;
    v_to := trim(p_to) || coalesce(' · ' || trim(to_char(p_qty, 'FM999999990.###')) || ' ' || coalesce(v_unit, ''), '');
  elsif p_kind = 'remove_step' then
    if p_step is null then raise exception 'Chọn bước muốn bỏ'; end if;
    v_from := 'Bước ' || p_step || coalesce('. ' || v_step_title, ''); v_to := 'Bỏ cả bước này';
  elsif p_kind = 'add_step' then
    if nullif(trim(p_title), '') is null then raise exception 'Ghi tên bước muốn thêm'; end if;
    if v_pid is not null and p_qty is null then raise exception 'Nhập định lượng cho sản phẩm của bước thêm'; end if;
    v_from := case when coalesce(p_step, 0) = 0 then 'Thêm bước ở đầu quy trình' else 'Thêm bước sau bước ' || p_step end
              || ': ' || trim(p_title);
    v_to := coalesce(nullif(trim(p_to), '') || coalesce(' · ' || trim(to_char(p_qty, 'FM999999990.###')) || ' ' || coalesce(v_unit, ''), ''),
                     'Không kèm sản phẩm');
  end if;

  insert into public.procedure_change_requests
    (appointment_service_id, step_no, from_product, to_product, to_product_id, reason, requested_by,
     kind, item_id, new_qty, step_title, parent_id, product_label)
  values (p_aps, coalesce(p_step, coalesce(v_parent.step_no, 0)), v_from, v_to,
          case when p_kind in ('swap','add_product','add_step') then v_pid end,
          trim(p_reason), (select auth.uid()),
          p_kind, p_item, case when p_kind in ('swap','qty','add_product','add_step') then p_qty end,
          case when p_kind = 'add_step' then trim(p_title) end, p_parent,
          case when p_kind in ('swap','add_product','add_step') then nullif(trim(p_to), '') end)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.request_procedure_adjust(uuid, text, int, text, uuid, uuid, text, uuid, numeric, text) from public, anon;
grant execute on function public.request_procedure_adjust(uuid, text, int, text, uuid, uuid, text, uuid, numeric, text) to authenticated;

-- KTV huỷ yêu cầu của mình khi còn chờ duyệt
create or replace function public.cancel_procedure_change(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.procedure_change_requests
     set status = 'cancelled', reviewed_at = now(), reviewed_by = (select auth.uid())
   where id = p_id and status = 'pending'
     and (requested_by = (select auth.uid()) or public.has_role('owner','manager'));
  if not found then raise exception 'Yêu cầu đã được xử lý hoặc không phải của bạn'; end if;
  -- huỷ bước thêm → huỷ luôn các sản phẩm xin thêm vào bước đó
  update public.procedure_change_requests set status = 'cancelled', reviewed_at = now()
   where parent_id = p_id and status = 'pending';
end $$;
revoke execute on function public.cancel_procedure_change(uuid) from public, anon;
grant execute on function public.cancel_procedure_change(uuid) to authenticated;

-- Duyệt: không duyệt được sau khi buổi đã hoàn thành (kho đã trừ)
create or replace function public.review_procedure_change(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_done timestamptz;
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ chủ spa / quản lý duyệt'; end if;
  select s.work_done_at into v_done from public.procedure_change_requests c
    join public.appointment_services s on s.id = c.appointment_service_id where c.id = p_id;
  if p_approve and v_done is not null then
    raise exception 'Buổi đã hoàn thành và đã trừ kho – không duyệt điều chỉnh được nữa';
  end if;
  update public.procedure_change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = nullif(trim(p_note), '')
   where id = p_id and status = 'pending';
  if not found then raise exception 'Yêu cầu đã được xử lý'; end if;
  -- không duyệt bước thêm → các sản phẩm xin thêm vào bước đó cũng không duyệt
  if not p_approve then
    update public.procedure_change_requests set status = 'rejected', reviewed_by = (select auth.uid()), reviewed_at = now()
     where parent_id = p_id and status = 'pending';
  end if;
end $$;
revoke execute on function public.review_procedure_change(uuid, boolean, text) from public, anon;
grant execute on function public.review_procedure_change(uuid, boolean, text) to authenticated;

-- Thông báo cho quản lý: đổi nhãn
do $$
declare d text;
begin
  d := pg_get_functiondef('private.on_request_change()'::regprocedure);
  d := replace(d, '''KTV xin đổi sản phẩm''', '''KTV xin điều chỉnh quy trình''');
  execute d;
end $$;

-- Hoàn thành buổi: chặn khi còn yêu cầu chờ duyệt
create or replace function public._consume_session(p_aps uuid, p_choices jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_wh uuid := public._session_warehouse(p_aps);
  r record; b record;
  v_left numeric; v_take numeric; v_after numeric; v_short text := '';
begin
  if exists (select 1 from public.treatment_usages where appointment_service_id = p_aps) then return; end if;
  if exists (select 1 from public.procedure_change_requests where appointment_service_id = p_aps and status = 'pending') then
    raise exception 'Còn yêu cầu điều chỉnh quy trình chờ quản lý duyệt. Chờ duyệt (hoặc huỷ yêu cầu) rồi mới Hoàn thành buổi.';
  end if;
  -- kiểm tra đủ trước
  for r in
    select t.product_id, t.need, p.name, p.capacity, p.unit, p.volume,
           coalesce((select sum(coalesce(oi.remaining_qty, 0)) from public.opened_items oi
                      where oi.warehouse_id = v_wh and oi.product_id = t.product_id and oi.status = 'open'), 0) avail
      from (select n.product_id, sum(n.qty) need from public._session_needs(p_aps, coalesce(p_choices, '{}'::jsonb)) n group by n.product_id) t
      join public.products p on p.id = t.product_id
     where not public.is_single_use_product(p.unit, p.volume)
  loop
    if r.avail + 0.0005 < r.need then
      v_short := v_short || case when v_short = '' then '' else '; ' end
        || concat_ws(' · ', r.name, r.capacity) || ' (cần ' || trim(to_char(r.need, 'FM999999990.999')) || ' ' || public.volume_unit(r.capacity, r.unit)
        || case when r.avail > 0 then ', chai đang mở còn ' || trim(to_char(r.avail, 'FM999999990.999')) else ', chưa có chai đang mở' end || ')';
    end if;
  end loop;
  if v_short <> '' then
    raise exception 'Chi nhánh không đủ sản phẩm đang mở: %. Gửi Xin xuất chai mới hoặc xin chủ spa xác nhận còn hàng rồi mới Hoàn thành được.', v_short;
  end if;
  -- trừ: chai mở trước trừ trước
  for r in
    select t.product_id, t.need, p.volume
      from (select n.product_id, sum(n.qty) need from public._session_needs(p_aps, coalesce(p_choices, '{}'::jsonb)) n group by n.product_id) t
      join public.products p on p.id = t.product_id
     where not public.is_single_use_product(p.unit, p.volume)
  loop
    v_left := r.need;
    for b in
      select oi.id, coalesce(oi.remaining_qty, 0) q from public.opened_items oi
       where oi.warehouse_id = v_wh and oi.product_id = r.product_id and oi.status = 'open' and coalesce(oi.remaining_qty, 0) > 0
       order by oi.opened_at, oi.id for update
    loop
      exit when v_left <= 0;
      v_take := least(v_left, b.q);
      v_after := round(b.q - v_take, 3);
      if v_after <= 0.0005 then v_after := 0; end if;
      update public.opened_items
         set remaining_qty = v_after,
             remaining_pct = case when r.volume > 0 then least(100, round(v_after / r.volume * 100, 2)) else 0 end,
             status = case when v_after = 0 then 'finished' else status end,
             finished_at = case when v_after = 0 then now() else finished_at end,
             finished_by = case when v_after = 0 then (select auth.uid()) else finished_by end,
             finish_note = case when v_after = 0 then 'Tự động: dùng hết theo định mức liệu trình' else finish_note end
       where id = b.id;
      insert into public.treatment_usages (appointment_service_id, warehouse_id, product_id, opened_item_id, qty, qty_before, qty_after)
      values (p_aps, v_wh, r.product_id, b.id, v_take, b.q, v_after);
      v_left := v_left - v_take;
    end loop;
  end loop;
end $$;
revoke execute on function public._consume_session(uuid, jsonb) from public, anon, authenticated;

