-- Quy cách hộp / ống (13/11/2026)
-- Tồn kho luôn tính theo ĐƠN VỊ LẺ (ống / lọ / chai / miếng…): products.unit + products.volume (ml mỗi đơn vị lẻ).
-- products.pack_size = số đơn vị lẻ trong 1 hộp (null = không đóng hộp). Khi nhập hàng / kiểm kho
-- được chọn "Theo hộp" (số hộp × số ống/hộp) hoặc "Theo ống" — app quy đổi ra đơn vị lẻ.

alter table public.products add column if not exists pack_size int
  check (pack_size is null or pack_size between 2 and 100000);
alter table public.stock_receipt_items add column if not exists pack_size int
  check (pack_size is null or pack_size between 2 and 100000);

-- Cho phép hàm quy đổi đơn vị chia lại giá vốn (NV kho không được sửa giá vốn trực tiếp)
create or replace function public.products_guard_cost()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  if current_setting('app.pack_convert', true) = '1' then return new; end if;
  if auth.uid() is not null and not public.has_role('owner','manager') then
    if tg_op = 'INSERT' then new.cost_price := null; new.supplier_list_price := null;
    else new.cost_price := old.cost_price; new.supplier_list_price := old.supplier_list_price; end if;
  end if;
  return new;
end $function$;

/** "Hộp 10 ống x 2.5ml" · "Ống 5ml" · "Hộp 100 cặp" · "1 set" */
create or replace function public.pack_capacity(p_unit text, p_volume numeric, p_pack int, p_vu text default 'ml')
 returns text language sql immutable set search_path to ''
as $function$
  select case
    when coalesce(p_volume, 1) <= 1 then
      case when p_pack is not null then 'Hộp ' || p_pack || ' ' || p_unit else '1 ' || p_unit end
    when p_pack is not null then
      'Hộp ' || p_pack || ' ' || p_unit || ' x ' || trim_scale(p_volume)::text || coalesce(nullif(p_vu, ''), 'ml')
    else initcap(p_unit) || ' ' || trim_scale(p_volume)::text || coalesce(nullif(p_vu, ''), 'ml')
  end
$function$;

/** Đổi đơn vị lẻ / dung tích / số ống mỗi hộp của sản phẩm. Nếu đang còn tồn mà đơn vị cũ to hơn (hộp → ống, chai 50ml → ống 10ml)
 *  thì nhân số tồn, chia giá vốn theo hệ số; chai đang mở giữ nguyên số ml (phần đủ 1 ống trở thành ống nguyên). */
create or replace function public._convert_product_pack(p_id uuid, p_unit text, p_volume numeric, p_pack int)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare
  o public.products;
  v_unit text := lower(trim(coalesce(p_unit, '')));
  v_vol numeric := p_volume;
  v_f numeric := 1;
  v_has boolean;
  v_vu text;
  b record; v_full int; v_rest numeric;
begin
  select * into o from public.products where id = p_id and deleted_at is null for update;
  if o.id is null then raise exception 'Không tìm thấy sản phẩm'; end if;
  if v_unit = '' then raise exception 'Chọn đơn vị lẻ (ống, lọ, chai…)'; end if;
  if v_unit = 'hộp' and p_pack is not null then raise exception 'Đơn vị lẻ không thể là hộp khi đã ghi số ống / hộp'; end if;
  if v_unit in ('cái','miếng','gói','túi','cặp','set','bộ') then v_vol := 1; end if;
  if v_vol is not null and (v_vol <= 0 or v_vol > 100000) then raise exception 'Dung tích không hợp lệ'; end if;
  if p_pack is not null and (p_pack < 2 or p_pack > 100000) then raise exception 'Số đơn vị lẻ mỗi hộp phải từ 2 trở lên'; end if;

  if v_unit = o.unit and v_vol is not distinct from o.volume and p_pack is not distinct from o.pack_size then return; end if;

  v_has := exists (select 1 from public.stock_movements where product_id = p_id)
        or exists (select 1 from public.opened_items where product_id = p_id and status = 'open')
        or exists (select 1 from public.stock_receipt_items i join public.stock_receipts r on r.id = i.receipt_id where i.product_id = p_id and r.status = 'pending');

  if v_has and v_unit <> lower(o.unit) then
    -- hệ số quy đổi: dung tích cũ / dung tích mới; cũ là hộp chưa có dung tích thì theo số ống / hộp
    if o.volume is not null and v_vol is not null and v_vol > 0 then
      v_f := o.volume / v_vol;
    elsif lower(o.unit) = 'hộp' and p_pack is not null then
      v_f := p_pack;
    end if;
    if abs(v_f - round(v_f)) > 0.001 or round(v_f) < 1 then
      raise exception 'Sản phẩm đang còn tồn: không quy đổi được % % sang % % (không chia hết). Hãy kiểm kho lại sau khi đổi.',
        o.volume, o.unit, v_vol, v_unit;
    end if;
    v_f := round(v_f);
    if v_f > 1 and exists (select 1 from public.invoice_items where product_id = p_id) then
      raise exception 'Sản phẩm đã bán lẻ trên hoá đơn: giữ nguyên đơn vị bán (%).', o.unit;
    end if;
  end if;

  perform set_config('app.pack_convert', '1', true);
  if v_f > 1 then
    update public.stock_movements set quantity = quantity * v_f, unit_cost = round(unit_cost / v_f) where product_id = p_id;
    update public.stock_receipt_items set quantity = quantity * v_f, unit_cost = round(unit_cost / v_f), list_price = round(list_price / v_f),
           pack_size = coalesce(pack_size, case when v_f >= 2 then v_f::int end)
     where product_id = p_id;
    update public.stock_count_items set system_qty = system_qty * v_f, counted_qty = counted_qty * v_f where product_id = p_id;
    update public.stock_request_items set quantity = quantity * v_f where product_id = p_id;
  end if;

  update public.products
     set unit = v_unit, volume = v_vol, pack_size = p_pack,
         capacity = public.pack_capacity(v_unit, v_vol, p_pack,
                      case when public.volume_unit(o.capacity, o.unit) = 'g' then 'g' else 'ml' end),
         cost_price = case when v_f > 1 then round(cost_price / v_f) else cost_price end,
         supplier_list_price = case when v_f > 1 then round(supplier_list_price / v_f) else supplier_list_price end,
         retail_price = case when v_f > 1 then round(retail_price / v_f) else retail_price end
   where id = p_id;

  -- chai / hộp đang mở: giữ số ml; phần đủ 1 đơn vị lẻ mới thành hàng nguyên trong kho
  if v_f > 1 and v_vol is not null and v_vol > 1 then
    for b in select * from public.opened_items where product_id = p_id and status = 'open' for update loop
      v_full := floor(coalesce(b.remaining_qty, 0) / v_vol + 0.0005);
      v_rest := round(coalesce(b.remaining_qty, 0) - v_full * v_vol, 3);
      if v_full > 0 then
        insert into public.stock_movements (warehouse_id, product_id, movement_type, quantity, unit_cost, note)
        values (b.warehouse_id, p_id, 'adjustment', v_full, round(coalesce(b.unit_cost, 0) * v_vol / nullif(b.remaining_qty, 0)),
                'Đổi đơn vị: ' || o.unit || ' đang mở → ' || v_full || ' ' || v_unit || ' nguyên');
      end if;
      if v_rest <= 0.0005 then
        delete from public.opened_items where id = b.id;
      else
        update public.opened_items set remaining_qty = v_rest, remaining_pct = least(100, round(v_rest / v_vol * 100, 2)) where id = b.id;
      end if;
    end loop;
  end if;
  perform set_config('app.pack_convert', '', true);
end $function$;
revoke all on function public._convert_product_pack(uuid, text, numeric, int) from public, anon, authenticated;

create or replace function public.set_product_pack(p_id uuid, p_unit text, p_volume numeric, p_pack int)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  if not public.has_role('owner', 'manager', 'warehouse') then
    raise exception 'Chỉ chủ spa, quản lý hoặc NV kho được sửa quy cách sản phẩm';
  end if;
  perform public._convert_product_pack(p_id, p_unit, p_volume, p_pack);
end $function$;
grant execute on function public.set_product_pack(uuid, text, numeric, int) to authenticated;

-- Gộp sản phẩm: chuyển cả quy trình liệu trình, chai đang mở, lịch sử trừ hàng sang mã giữ lại
create or replace function public._merge_products_core(p_keep uuid, p_drop uuid)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare
  d public.products;
  k public.products;
begin
  if p_keep is null or p_drop is null or p_keep = p_drop then raise exception 'Chọn 2 sản phẩm khác nhau để gộp'; end if;
  select * into k from public.products where id = p_keep and deleted_at is null for update;
  select * into d from public.products where id = p_drop and deleted_at is null for update;
  if k.id is null or d.id is null then raise exception 'Không tìm thấy sản phẩm'; end if;

  update public.stock_count_items ki
     set system_qty = ki.system_qty + di.system_qty, counted_qty = ki.counted_qty + di.counted_qty
    from public.stock_count_items di
   where ki.product_id = p_keep and di.product_id = p_drop and di.count_id = ki.count_id;
  delete from public.stock_count_items di
   where di.product_id = p_drop
     and exists (select 1 from public.stock_count_items ki where ki.count_id = di.count_id and ki.product_id = p_keep);
  update public.stock_count_items set product_id = p_keep where product_id = p_drop;

  update public.stock_request_items ki
     set quantity = ki.quantity + di.quantity
    from public.stock_request_items di
   where ki.product_id = p_keep and di.product_id = p_drop and di.request_id = ki.request_id;
  delete from public.stock_request_items di
   where di.product_id = p_drop
     and exists (select 1 from public.stock_request_items ki where ki.request_id = di.request_id and ki.product_id = p_keep);
  update public.stock_request_items set product_id = p_keep where product_id = p_drop;

  update public.stock_movements set product_id = p_keep where product_id = p_drop;
  update public.stock_receipt_items set product_id = p_keep where product_id = p_drop;
  update public.invoice_items set product_id = p_keep where product_id = p_drop;
  update public.promotion_items set product_id = p_keep where product_id = p_drop;
  update public.opened_items set product_id = p_keep where product_id = p_drop;
  update public.stock_count_opened set product_id = p_keep where product_id = p_drop;
  update public.treatment_usages set product_id = p_keep where product_id = p_drop;
  update public.usage_stock_confirms set product_id = p_keep where product_id = p_drop;
  update public.procedure_change_requests set to_product_id = p_keep where to_product_id = p_drop;
  update public.service_step_items
     set product_id = case when product_id = p_drop then p_keep else product_id end,
         product_name = case when product_id = p_drop then k.name else product_name end,
         alt_product_ids = array_remove(array(select distinct case when x = p_drop then p_keep else x end from unnest(alt_product_ids) x), p_keep)
   where product_id = p_drop or p_drop = any(alt_product_ids);

  update public.products
     set is_active = false, barcode = null, sku = null, deleted_at = now(),
         note = concat_ws(' · ', nullif(note, ''), 'Đã gộp vào ' || concat_ws(' ', k.brand, k.name, k.capacity))
   where id = p_drop;

  update public.products
     set for_treatment = k.for_treatment or d.for_treatment,
         for_retail = k.for_retail or d.for_retail,
         is_active = true,
         barcode = coalesce(k.barcode, d.barcode),
         sku = coalesce(k.sku, d.sku),
         brand = coalesce(nullif(k.brand, ''), d.brand),
         capacity = coalesce(nullif(k.capacity, ''), d.capacity),
         volume = coalesce(k.volume, d.volume),
         pack_size = coalesce(k.pack_size, d.pack_size),
         category = coalesce(k.category, d.category),
         used_in = coalesce(k.used_in, d.used_in),
         retail_price = coalesce(k.retail_price, d.retail_price),
         cost_price = coalesce(k.cost_price, d.cost_price),
         supplier_list_price = coalesce(k.supplier_list_price, d.supplier_list_price),
         max_staff_discount_pct = coalesce(k.max_staff_discount_pct, d.max_staff_discount_pct),
         expiry_date = least(k.expiry_date, d.expiry_date),
         min_stock = greatest(k.min_stock, d.min_stock)
   where id = p_keep;
  perform public.refresh_product_expiry(p_keep);
end $function$;
revoke all on function public._merge_products_core(uuid, uuid) from public, anon, authenticated;

create or replace function public.merge_products(p_keep uuid, p_drop uuid)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  if not public.has_role('owner', 'manager') then raise exception 'Chỉ chủ spa hoặc quản lý được gộp sản phẩm'; end if;
  perform public._merge_products_core(p_keep, p_drop);
end $function$;

-- Phiếu nhập: ghi lại nhập theo hộp (pack_size) để chủ spa duyệt giá theo hộp
create or replace function public.receive_stock(p_warehouse_id uuid, p_supplier text, p_note text, p_items jsonb, p_extra_costs jsonb DEFAULT '[]'::jsonb)
 returns uuid language plpgsql security definer set search_path to ''
as $function$
declare
  v_id uuid;
  v_it jsonb;
  v_qty int;
  v_pack int;
  v_prod uuid;
  v_exp date;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_extra jsonb := '[]'::jsonb;
  v_extra_total numeric := 0;
  v_amt numeric;
begin
  if not public.can_manage_warehouse(p_warehouse_id) then raise exception 'Bạn không có quyền nhập hàng vào kho này'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Phiếu nhập chưa có sản phẩm';
  end if;
  if p_extra_costs is not null and jsonb_typeof(p_extra_costs) = 'array' then
    for v_it in select value from jsonb_array_elements(p_extra_costs) loop
      v_amt := round(coalesce(nullif(v_it->>'amount', '')::numeric, 0));
      if v_amt < 0 then raise exception 'Chi phí không hợp lệ'; end if;
      if v_amt > 0 then
        v_extra := v_extra || jsonb_build_object('label', coalesce(nullif(trim(v_it->>'label'), ''), 'Chi phí khác'), 'amount', v_amt);
        v_extra_total := v_extra_total + v_amt;
      end if;
    end loop;
  end if;
  insert into public.stock_receipts (warehouse_id, supplier, note, extra_costs, extra_cost_total, status)
  values (p_warehouse_id, nullif(trim(p_supplier), ''), nullif(trim(p_note), ''), v_extra, v_extra_total, 'pending')
  returning id into v_id;
  for v_it in select value from jsonb_array_elements(p_items) loop
    v_prod := (v_it->>'product_id')::uuid;
    v_qty := (v_it->>'quantity')::int;
    v_pack := nullif(v_it->>'pack_size', '')::int;
    v_exp := nullif(v_it->>'expiry_date', '')::date;
    if v_qty is null or v_qty < 1 or v_qty > 100000 then raise exception 'Số lượng nhập không hợp lệ'; end if;
    if v_pack is not null and (v_pack < 2 or v_qty % v_pack <> 0) then v_pack := null; end if;
    if v_exp is not null and v_exp <= v_today then raise exception 'Hạn sử dụng phải sau hôm nay'; end if;
    if not exists (select 1 from public.products where id = v_prod) then raise exception 'Sản phẩm không tồn tại'; end if;
    insert into public.stock_receipt_items (receipt_id, product_id, quantity, expiry_date, pack_size) values (v_id, v_prod, v_qty, v_exp, v_pack);
  end loop;
  return v_id;
end $function$;
-- (đã sửa: dùng trim_scale để 2.5 không bị làm tròn thành 3)
