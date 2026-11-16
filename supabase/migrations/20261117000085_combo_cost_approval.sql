-- TẠO COMBO + KIỂM TRA COST (17/11/2026)
-- • Quản lý / chủ tạo combo từ liệu trình lẻ hoặc cả nhóm liệu trình.
-- • Cost combo = Σ (số buổi × cost cao nhất trong các liệu trình được chọn của phần đó).
--   Cost 1 liệu trình = Σ định lượng sản phẩm × giá nhập trung bình (giống trang Cost liệu trình).
-- • Quản lý lưu combo mà cost > giá bán (hoặc chưa tính được cost / có phần không giới hạn buổi)
--   → combo KHÔNG được bán, chuyển "chờ chủ duyệt". Quản lý không bao giờ thấy con số cost.
-- • Chủ lưu thì luôn được (chủ là người duyệt) – giao diện tự cảnh báo trước.

alter table public.packages
  add column if not exists approval_status text not null default 'approved'
    check (approval_status in ('approved', 'pending', 'rejected')),
  add column if not exists approval_reason text,
  add column if not exists review_note text,
  add column if not exists submitted_by uuid references public.profiles(id),
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id),
  add column if not exists reviewed_at timestamptz;

-- Cost từng liệu trình (nội bộ). missing = số sản phẩm trong quy trình chưa có giá nhập.
create or replace function public._service_costs(p_ids uuid[])
returns table (service_id uuid, cost numeric, missing int)
language sql stable security definer set search_path = '' as $$
  with ids as (select distinct unnest(p_ids) id),
  i as (
    select si.service_id, si.product_id, si.qty
      from public.service_step_items si
     where si.service_id in (select id from ids) and si.product_id is not null and si.qty is not null
  ),
  c as (select * from public._avg_costs(coalesce((select array_agg(distinct product_id) from i), '{}'::uuid[]))),
  l as (
    select i.service_id,
           case when c.avg_cost is null then null
                when public.is_single_use_product(p.unit, p.volume) then i.qty * c.avg_cost
                when p.volume > 0 then i.qty / p.volume * c.avg_cost
           end line
      from i join public.products p on p.id = i.product_id
      left join c on c.product_id = i.product_id
  )
  select ids.id, coalesce(round(sum(l.line)), 0), (count(l.service_id) - count(l.line))::int
    from ids left join l on l.service_id = ids.id
   group by ids.id
$$;
revoke execute on function public._service_costs(uuid[]) from public, anon, authenticated;

-- Cho giao diện của CHỦ: cost từng liệu trình. Không phải chủ → rỗng.
create or replace function public.service_costs(p_ids uuid[])
returns table (service_id uuid, cost numeric, missing int)
language sql stable security definer set search_path = '' as $$
  select * from public._service_costs(p_ids) where public.has_role('owner')
$$;
revoke execute on function public.service_costs(uuid[]) from public, anon;
grant execute on function public.service_costs(uuid[]) to authenticated;

-- Cost cả combo từ danh sách phần (nội bộ).
create or replace function public._combo_cost(p_items jsonb)
returns table (cost numeric, missing int, unlimited boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_it jsonb; v_ids uuid[]; v_max numeric; v_miss int;
  v_cost numeric := 0; v_missing int := 0; v_unl boolean := false;
begin
  for v_it in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(coalesce(v_it->'service_ids', '[]'::jsonb)) x;
    if v_ids is null then continue; end if;
    select max(sc.cost), sum(sc.missing) into v_max, v_miss from public._service_costs(v_ids) sc;
    v_missing := v_missing + coalesce(v_miss, 0);
    if nullif(v_it->>'quantity', '') is null then
      v_unl := true;
    else
      v_cost := v_cost + (v_it->>'quantity')::int * coalesce(v_max, 0);
    end if;
  end loop;
  return query select round(v_cost), v_missing, v_unl;
end $$;
revoke execute on function public._combo_cost(jsonb) from public, anon, authenticated;

-- Chặn ghi thẳng (không qua save_package / review_package): người không phải chủ
-- không đổi được trạng thái duyệt, và gói chưa duyệt không thể bật "Đang bán".
create or replace function public.packages_guard_approval()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' or public.has_role('owner') then return new; end if;
  if tg_op = 'INSERT' then
    new.approval_status := 'pending';
    new.approval_reason := coalesce(new.approval_reason, 'Tạo trực tiếp – cần chủ kiểm tra');
  else
    new.approval_status := old.approval_status;
    new.approval_reason := old.approval_reason;
    new.review_note := old.review_note;
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
    new.submitted_by := old.submitted_by;
    new.submitted_at := old.submitted_at;
  end if;
  if new.approval_status <> 'approved' then new.is_active := false; end if;
  return new;
end $$;
drop trigger if exists packages_guard_approval on public.packages;
create trigger packages_guard_approval before insert or update on public.packages
  for each row execute function public.packages_guard_approval();

-- Lưu gói: nay chạy quyền hệ thống để tự tính cost (quản lý không đọc được giá nhập).
create or replace function public.save_package(
  p_id uuid, p_name text, p_price numeric, p_validity_days int, p_description text,
  p_is_active boolean, p_items jsonb, p_category text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_it jsonb;
  v_item uuid;
  v_ord int := 0;
  v_owner boolean := public.has_role('owner');
  v_cost numeric; v_missing int; v_unl boolean;
  v_reason text;
  v_status text := 'approved';
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ chủ / quản lý được sửa gói combo'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Vui lòng nhập tên gói'; end if;
  if p_price is null or p_price < 0 then raise exception 'Giá gói không hợp lệ'; end if;
  if p_validity_days is not null and p_validity_days <= 0 then raise exception 'Hạn dùng phải lớn hơn 0 ngày'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Gói cần ít nhất 1 phần dịch vụ'; end if;

  if not v_owner then
    select c.cost, c.missing, c.unlimited into v_cost, v_missing, v_unl from public._combo_cost(p_items) c;
    if v_cost > round(p_price) then
      v_reason := 'Giá bán thấp hơn chi phí liệu trình';
    elsif v_unl then
      v_reason := 'Có phần không giới hạn buổi – không tự tính được chi phí';
    elsif v_missing > 0 then
      v_reason := 'Có sản phẩm trong quy trình chưa có giá nhập – chưa tính đủ chi phí';
    end if;
    if v_reason is not null then v_status := 'pending'; end if;
  end if;

  if v_id is null then
    insert into public.packages (name, price, validity_days, description, is_active, category, sort_order,
                                 approval_status, approval_reason, submitted_by, submitted_at)
    values (trim(p_name), round(p_price), p_validity_days, nullif(trim(p_description), ''),
            coalesce(p_is_active, true) and v_status = 'approved',
            nullif(trim(p_category), ''), (select coalesce(max(sort_order), 0) + 1 from public.packages where sort_order < 999),
            v_status, v_reason, auth.uid(), now())
    returning id into v_id;
  else
    update public.packages
       set name = trim(p_name), price = round(p_price), validity_days = p_validity_days,
           description = nullif(trim(p_description), ''),
           is_active = coalesce(p_is_active, true) and v_status = 'approved',
           category = nullif(trim(p_category), ''),
           approval_status = v_status, approval_reason = v_reason,
           review_note = case when v_status = 'pending' then null else review_note end,
           submitted_by = auth.uid(), submitted_at = now()
     where id = v_id;
    if not found then raise exception 'Không tìm thấy gói'; end if;
    delete from public.package_items where package_id = v_id;
  end if;

  for v_it in select value from jsonb_array_elements(p_items) loop
    if jsonb_array_length(coalesce(v_it->'service_ids', '[]'::jsonb)) = 0 then
      raise exception 'Mỗi phần của gói cần ít nhất 1 dịch vụ';
    end if;
    v_ord := v_ord + 1;
    insert into public.package_items (package_id, label, quantity, unit_price, sort_order)
    values (v_id, coalesce(nullif(trim(v_it->>'label'), ''), 'Phần ' || v_ord),
            nullif(v_it->>'quantity', '')::int, round(nullif(v_it->>'unit_price', '')::numeric), v_ord)
    returning id into v_item;
    if nullif(trim(v_it->>'note'), '') is not null then
      insert into public.package_item_notes (item_id, note) values (v_item, trim(v_it->>'note'));
    end if;
    insert into public.package_item_services (item_id, service_id)
    select distinct v_item, x::uuid from jsonb_array_elements_text(v_it->'service_ids') x;
  end loop;

  if v_status = 'pending' then
    perform public.notify_users(public.staff_recipients(array['owner']::public.user_role[], null), 'approval',
      'Combo cần duyệt', trim(p_name) || ' · ' || v_reason, '/quan-ly/cho-duyet#combo', 'combo-' || v_id);
  end if;
  return v_id;
end $$;
revoke execute on function public.save_package(uuid, text, numeric, int, text, boolean, jsonb, text) from public, anon;
grant execute on function public.save_package(uuid, text, numeric, int, text, boolean, jsonb, text) to authenticated;

-- Danh sách combo chờ duyệt kèm cost – chỉ chủ.
create or replace function public.pending_package_costs()
returns table (package_id uuid, cost numeric, missing int, unlimited boolean, retail numeric)
language sql stable security definer set search_path = '' as $$
  select p.id, c.cost, c.missing, c.unlimited,
         (select coalesce(sum(i.quantity * i.unit_price), 0) from public.package_items i where i.package_id = p.id)
    from public.packages p
    cross join lateral public._combo_cost((
      select jsonb_agg(jsonb_build_object('quantity', i.quantity,
               'service_ids', (select coalesce(jsonb_agg(s.service_id), '[]'::jsonb) from public.package_item_services s where s.item_id = i.id)))
        from public.package_items i where i.package_id = p.id)) c
   where p.approval_status = 'pending' and public.has_role('owner')
$$;
revoke execute on function public.pending_package_costs() from public, anon;
grant execute on function public.pending_package_costs() to authenticated;

-- Chủ duyệt / từ chối combo.
create or replace function public.review_package(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pkg public.packages;
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa được duyệt combo'; end if;
  select * into v_pkg from public.packages where id = p_id;
  if not found then raise exception 'Không tìm thấy gói'; end if;
  if v_pkg.approval_status <> 'pending' then raise exception 'Combo này không còn chờ duyệt'; end if;
  if not p_approve and nullif(trim(p_note), '') is null then raise exception 'Vui lòng ghi lý do từ chối'; end if;
  update public.packages
     set approval_status = case when p_approve then 'approved' else 'rejected' end,
         is_active = p_approve,
         review_note = nullif(trim(p_note), ''),
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  if v_pkg.submitted_by is not null and v_pkg.submitted_by <> auth.uid() then
    perform public.notify_users(array[v_pkg.submitted_by], 'result',
      case when p_approve then 'Combo đã được duyệt' else 'Combo bị từ chối' end,
      v_pkg.name || coalesce(' · ' || nullif(trim(p_note), ''), ''), '/quan-ly/goi-combo', 'combo-' || p_id);
  end if;
end $$;
revoke execute on function public.review_package(uuid, boolean, text) from public, anon;
grant execute on function public.review_package(uuid, boolean, text) to authenticated;

-- Combo chưa duyệt / bị từ chối không bán được (kể cả chủ / quản lý bán gói "ngừng bán").
create or replace function public.customer_packages_require_approved()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.packages p where p.id = new.package_id and p.approval_status <> 'approved') then
    raise exception 'Combo này đang chờ chủ spa duyệt (hoặc bị từ chối) nên chưa bán được';
  end if;
  return new;
end $$;
drop trigger if exists customer_packages_require_approved on public.customer_packages;
create trigger customer_packages_require_approved before insert on public.customer_packages
  for each row execute function public.customer_packages_require_approved();
